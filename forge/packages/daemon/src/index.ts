/**
 * @forge/daemon — Autonomous intelligence layer.
 *
 * Five systems that make Forge self-operating and self-defending:
 *
 * 1. Daemon engine  — always-on state machine with self-healing watchdog
 * 2. Federation     — privacy-preserving cross-deployment annotation sharing
 * 3. RL guard       — tournament scoring integrity (prevents reward gaming)
 * 4. T34 pipeline   — external data feed tamper detection
 * 5. T35 surface    — personal agent surface boundary enforcement
 */

import { createHmac, createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@forge/db";
import { recordAnnotation, getAnnotationsForDomain } from "@forge/intent-graph";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DaemonComponent =
  | "probe_runner" | "graveyard_checker" | "payroll" | "pairing"
  | "federation_sync" | "pipeline_guard" | "personal_surface_guard"
  | "rl_guard" | "company_ops";

export type DaemonStatus = "idle" | "running" | "error" | "waiting_human" | "disabled";

export interface DaemonState {
  id: string;
  workspaceId: string;
  component: DaemonComponent;
  status: DaemonStatus;
  lastRunAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  runCount: number;
  errorCount: number;
  lastError?: string;
  consecutiveErrors: number;
  restartCount: number;
  heartbeatAt?: string;
}

export type ScanSeverity = "info" | "warning" | "critical";
export type PipelineVerdict = "clean" | "anomaly" | "tamper_suspected" | "baseline_building";
export type SurfaceVerdict = "allowed" | "blocked" | "requires_mfa";
export type RLRegime = "normal" | "suspicious" | "gaming" | "inconclusive";

// ─── 1. DAEMON ENGINE ─────────────────────────────────────────────────────────

export async function heartbeat(
  component: DaemonComponent,
  workspaceId?: string
): Promise<void> {
  const sql = getDb();
  const wsId = workspaceId ?? "00000000-0000-0000-0000-000000000001";
  await sql`
    INSERT INTO daemon_state (workspace_id, component, status, heartbeat_at, updated_at)
    VALUES (${wsId}::uuid, ${component}, 'running', NOW(), NOW())
    ON CONFLICT (workspace_id, component) DO UPDATE SET
      heartbeat_at = NOW(),
      status = 'running',
      updated_at = NOW()
  `.catch(() => {});
}

export async function markDaemonSuccess(
  component: DaemonComponent,
  workspaceId?: string
): Promise<void> {
  const sql = getDb();
  const wsId = workspaceId ?? "00000000-0000-0000-0000-000000000001";
  await sql`
    INSERT INTO daemon_state (
      workspace_id, component, status,
      last_run_at, last_success_at, run_count,
      consecutive_errors, heartbeat_at, updated_at
    ) VALUES (${wsId}::uuid, ${component}, 'idle', NOW(), NOW(), 1, 0, NOW(), NOW())
    ON CONFLICT (workspace_id, component) DO UPDATE SET
      status = 'idle',
      last_run_at = NOW(),
      last_success_at = NOW(),
      run_count = daemon_state.run_count + 1,
      consecutive_errors = 0,
      heartbeat_at = NOW(),
      updated_at = NOW()
  `.catch(() => {});
}

export async function markDaemonError(
  component: DaemonComponent,
  error: string,
  workspaceId?: string
): Promise<{ shouldRestart: boolean }> {
  const sql = getDb();
  const wsId = workspaceId ?? "00000000-0000-0000-0000-000000000001";

  const rows = await sql<Array<{
    consecutiveErrors: number; maxConsecutiveErrors: number; restartCount: number;
  }>>`
    UPDATE daemon_state SET
      status = 'error',
      last_error = ${error},
      error_count = error_count + 1,
      consecutive_errors = consecutive_errors + 1,
      updated_at = NOW()
    WHERE workspace_id = ${wsId}::uuid AND component = ${component}
    RETURNING consecutive_errors as "consecutiveErrors",
              max_consecutive_errors as "maxConsecutiveErrors",
              restart_count as "restartCount"
  `.catch(() => []);

  const state = rows[0];
  if (!state) return { shouldRestart: false };

  const shouldRestart = state.consecutiveErrors < state.maxConsecutiveErrors;

  if (shouldRestart) {
    await sql`
      UPDATE daemon_state SET
        restart_count = restart_count + 1,
        status = 'idle'
      WHERE workspace_id = ${wsId}::uuid AND component = ${component}
    `.catch(() => {});
  }

  return { shouldRestart };
}

export async function getDaemonHealth(workspaceId?: string): Promise<Array<{
  workspace: string; component: string; status: string;
  consecutiveErrors: number; health: string;
}>> {
  const sql = getDb();
  try {
    return sql<Array<{
      workspace: string; component: string; status: string;
      consecutiveErrors: number; health: string;
    }>>`SELECT * FROM v_daemon_health
        WHERE (${workspaceId ?? null}::text IS NULL OR workspace = ${workspaceId ?? null})`;
  } catch { return []; }
}

export async function recordScan(input: {
  component: DaemonComponent;
  scanType: string;
  severity: ScanSeverity;
  title: string;
  detail: Record<string, unknown>;
  humanRequired?: boolean;
  workspaceId?: string;
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO daemon_scan_results (
      workspace_id, component, scan_type, severity, title, detail, human_required
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.component}, ${input.scanType}, ${input.severity},
      ${input.title}, ${JSON.stringify(input.detail)}::jsonb,
      ${input.humanRequired ?? false}
    )
  `.catch(() => {});
}

// ─── 2. FEDERATED INTELLIGENCE ────────────────────────────────────────────────
// Privacy-preserving: only noisy aggregate signals, never raw content.
// Laplace noise (epsilon=0.1) applied to all counts before storage.

function laplaceNoise(sensitivity = 1, epsilon = 0.1): number {
  const u = Math.random() - 0.5;
  return -sensitivity / epsilon * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function fingerprintPattern(domain: string, key: string, contentType: string): string {
  const normalized = `${domain}:${key}:${contentType}`.toLowerCase().replace(/\s+/g, "-");
  return createHash("sha256").update(normalized).digest("hex").substring(0, 16);
}

export async function contributeToFederation(
  domain: string,
  verificationAttempts: number,
  firstPassRate: number,
  workspaceId?: string
): Promise<void> {
  const sql = getDb();
  const wsId = workspaceId ?? "00000000-0000-0000-0000-000000000001";

  // Apply Laplace noise before contributing
  const noisyAttempts = Math.max(0, Math.round(verificationAttempts + laplaceNoise(1, 0.1)));
  const noisyRate = Math.max(0, Math.min(1, firstPassRate + laplaceNoise(0.01, 0.1)));
  const fingerprint = fingerprintPattern(domain, "aggregate", "rate");

  await sql`
    INSERT INTO federation_contributions (
      workspace_id, domain, pattern_type,
      verification_attempts_noisy, first_pass_rate_noisy, pattern_fingerprint
    ) VALUES (
      ${wsId}::uuid, ${domain}, 'aggregate',
      ${noisyAttempts}, ${noisyRate}, ${fingerprint}
    )
  `.catch(() => {});
}

export async function syncFederationPriors(
  domain: string,
  workspaceId?: string
): Promise<{ globalRate: number | null; recommendedPatterns: string[] }> {
  const sql = getDb();
  const wsId = workspaceId ?? "00000000-0000-0000-0000-000000000001";

  try {
    // Get session count to compute local weight (20% at session 1 → 80% at session 100)
    const trustRows = await sql<Array<{ sessionCount: number; localWeight: number }>>`
      SELECT session_count as "sessionCount", local_weight as "localWeight"
      FROM federation_session_trust WHERE workspace_id = ${wsId}::uuid
    `.catch(() => [{ sessionCount: 1, localWeight: 0.2 }]);

    const sessionCount = trustRows[0]?.sessionCount ?? 1;
    const localWeight = Math.min(0.8, 0.2 + (sessionCount / 100) * 0.6);

    // Update trust
    await sql`
      INSERT INTO federation_session_trust (workspace_id, session_count, local_weight)
      VALUES (${wsId}::uuid, 1, ${localWeight})
      ON CONFLICT (workspace_id) DO UPDATE SET
        session_count = federation_session_trust.session_count + 1,
        local_weight = ${localWeight},
        last_updated = NOW()
    `.catch(() => {});

    // Get global prior for this domain
    const priorRows = await sql<Array<{
      globalFirstPassRate: number; recommendedPatterns: string[];
    }>>`
      SELECT global_first_pass_rate as "globalFirstPassRate",
             recommended_patterns as "recommendedPatterns"
      FROM federation_priors WHERE domain = ${domain}
    `.catch(() => []);

    const prior = priorRows[0];
    if (!prior) return { globalRate: null, recommendedPatterns: [] };

    await markDaemonSuccess("federation_sync", wsId);
    return {
      globalRate: prior.globalFirstPassRate,
      recommendedPatterns: prior.recommendedPatterns ?? [],
    };
  } catch {
    return { globalRate: null, recommendedPatterns: [] };
  }
}

export async function injectFederationContext(
  domain: string,
  workspaceId?: string
): Promise<string> {
  const { globalRate, recommendedPatterns } = await syncFederationPriors(domain, workspaceId);
  if (!globalRate) return "";

  const lines: string[] = [
    `## Federation intelligence (${domain} domain)`,
    "",
    `Global first-pass verification rate: ${(globalRate * 100).toFixed(1)}%`,
  ];

  if (recommendedPatterns.length > 0) {
    lines.push("High-success patterns from the federation:");
    recommendedPatterns.slice(0, 3).forEach((p) => lines.push(`- ${p}`));
  }

  lines.push("");
  return lines.join("\n");
}

// ─── 3. RL FEEDBACK GUARD ─────────────────────────────────────────────────────
// Detects when an agent is gaming the tournament scoring rubric.
// Three signals: score variance, test-claim alignment, implementation diversity.

export interface TournamentEntry {
  variantIndex: number;
  score: number;
  testCount: number;
  claimCount: number;
  implementationHash: string;
  explanation: string;
}

export interface RLGuardResult {
  regime: RLRegime;
  reason?: string;
  scoreVariance: number;
  testClaimAlignment: number;
  implementationDiversity: number;
  flaggedForReview: boolean;
}

export function assessTournament(entries: TournamentEntry[]): RLGuardResult {
  if (entries.length < 2) {
    return {
      regime: "inconclusive", reason: "Not enough variants to assess",
      scoreVariance: 0, testClaimAlignment: 1, implementationDiversity: 1,
      flaggedForReview: false,
    };
  }

  // Signal 1: Score variance — low variance = suspiciously uniform
  const scores = entries.map((e) => e.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  const scoreVariance = Math.min(1, variance / 0.1); // normalize

  // Signal 2: Test-claim alignment — too many tests per claim = probing implementation
  const testClaimRatios = entries.map((e) =>
    e.claimCount > 0 ? Math.min(1, e.claimCount / Math.max(1, e.testCount)) : 0
  );
  const testClaimAlignment = testClaimRatios.reduce((a, b) => a + b, 0) / testClaimRatios.length;

  // Signal 3: Implementation diversity — identical hashes = not actually different variants
  const uniqueHashes = new Set(entries.map((e) => e.implementationHash));
  const implementationDiversity = uniqueHashes.size / entries.length;

  // Classification
  const isGaming =
    scoreVariance < 0.05 &&           // scores almost identical
    implementationDiversity < 0.5 &&  // variants not genuinely different
    testClaimAlignment < 0.3;         // tests not aligned with claims

  const isSuspicious =
    implementationDiversity < 0.7 ||  // variants too similar
    testClaimAlignment < 0.4;         // tests skewing toward implementation

  const regime: RLRegime = isGaming ? "gaming" : isSuspicious ? "suspicious" : "normal";

  let reason: string | undefined;
  if (regime === "gaming") {
    reason = `Score variance too low (${scoreVariance.toFixed(3)}), implementations non-diverse (${(implementationDiversity * 100).toFixed(0)}%), tests not probing claims`;
  } else if (regime === "suspicious") {
    if (implementationDiversity < 0.7) reason = `Variants insufficiently diverse (${(implementationDiversity * 100).toFixed(0)}% unique)`;
    else reason = `Test suite appears to probe implementation rather than claims (alignment: ${(testClaimAlignment * 100).toFixed(0)}%)`;
  }

  return {
    regime, reason,
    scoreVariance, testClaimAlignment, implementationDiversity,
    flaggedForReview: regime !== "normal",
  };
}

export async function logRLScore(input: {
  buId?: string;
  agentId: string;
  entries: TournamentEntry[];
  winnerIndex: number;
  workspaceId?: string;
}): Promise<RLGuardResult> {
  const sql = getDb();
  const assessment = assessTournament(input.entries);
  const winner = input.entries[input.winnerIndex];

  await sql`
    INSERT INTO rl_scoring_log (
      bu_id, workspace_id, agent_id, variant_count, winning_variant, winning_score,
      score_variance, test_claim_alignment, implementation_diversity,
      regime, regime_reason, flagged_for_review
    ) VALUES (
      ${input.buId ?? null}::uuid,
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.agentId}, ${input.entries.length},
      ${input.winnerIndex}, ${winner?.score ?? 0},
      ${assessment.scoreVariance}, ${assessment.testClaimAlignment},
      ${assessment.implementationDiversity},
      ${assessment.regime}, ${assessment.reason ?? null},
      ${assessment.flaggedForReview}
    )
  `.catch(() => {});

  if (assessment.regime === "gaming" || assessment.regime === "suspicious") {
    await recordScan({
      component: "rl_guard",
      scanType: "tournament_gaming",
      severity: assessment.regime === "gaming" ? "critical" : "warning",
      title: `Tournament ${assessment.regime} detected${input.buId ? ` on BU ${input.buId.substring(0, 8)}` : ""}`,
      detail: { agentId: input.agentId, ...assessment },
      humanRequired: assessment.regime === "gaming",
      workspaceId: input.workspaceId,
    });
  }

  return assessment;
}

// ─── 4. T34 DATA PIPELINE INTEGRITY ──────────────────────────────────────────

export async function registerFeed(input: {
  feedName: string;
  feedUrl?: string;
  domain: string;
  checkIntervalMinutes?: number;
  workspaceId?: string;
}): Promise<string> {
  const sql = getDb();
  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO pipeline_feeds (
      workspace_id, feed_name, feed_url, domain, check_interval_minutes
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.feedName}, ${input.feedUrl ?? null}, ${input.domain},
      ${input.checkIntervalMinutes ?? 60}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id ?? "";
}

export async function checkPipelineIntegrity(input: {
  feedName: string;
  sampleValue: number;
  payload?: string;
  workspaceId?: string;
}): Promise<{ verdict: PipelineVerdict; zScore: number | null; blocked: boolean }> {
  const sql = getDb();
  const wsId = input.workspaceId ?? "00000000-0000-0000-0000-000000000001";

  const feedRows = await sql<Array<{
    id: string; baselineMean: number | null; baselineStddev: number | null;
    baselineSamples: number; baselineLocked: boolean;
  }>>`
    SELECT id, baseline_mean as "baselineMean", baseline_stddev as "baselineStddev",
           baseline_samples as "baselineSamples", baseline_locked as "baselineLocked"
    FROM pipeline_feeds
    WHERE feed_name = ${input.feedName} AND workspace_id = ${wsId}::uuid AND active = true
  `.catch(() => []);

  const feed = feedRows[0];
  if (!feed) return { verdict: "baseline_building", zScore: null, blocked: false };

  const contentHash = input.payload
    ? createHash("sha256").update(input.payload).digest("hex")
    : null;

  // Build baseline if not enough samples
  if (!feed.baselineLocked || feed.baselineSamples < 30) {
    // Update baseline stats (Welford online algorithm)
    const n = feed.baselineSamples + 1;
    const prevMean = feed.baselineMean ?? input.sampleValue;
    const newMean = prevMean + (input.sampleValue - prevMean) / n;
    const prevStddev = feed.baselineStddev ?? 0;
    const newStddev = n < 2 ? 0 : Math.sqrt(
      ((n - 2) * prevStddev ** 2 + (input.sampleValue - prevMean) * (input.sampleValue - newMean)) / (n - 1)
    );

    await sql`
      UPDATE pipeline_feeds SET
        baseline_mean = ${newMean},
        baseline_stddev = ${newStddev},
        baseline_samples = ${n},
        baseline_locked = ${n >= 30},
        last_checked_at = NOW()
      WHERE id = ${feed.id}
    `.catch(() => {});

    await sql`
      INSERT INTO pipeline_integrity_checks (
        feed_id, workspace_id, sample_value, verdict, content_hash
      ) VALUES (${feed.id}::uuid, ${wsId}::uuid, ${input.sampleValue}, 'baseline_building', ${contentHash})
    `.catch(() => {});

    return { verdict: "baseline_building", zScore: null, blocked: false };
  }

  // Compute z-score
  const stddev = feed.baselineStddev ?? 1;
  const zScore = stddev > 0
    ? (input.sampleValue - (feed.baselineMean ?? 0)) / stddev
    : 0;

  const verdict: PipelineVerdict = Math.abs(zScore) > 5
    ? "tamper_suspected"
    : Math.abs(zScore) > 3
    ? "anomaly"
    : "clean";

  const blocked = verdict === "tamper_suspected";

  await sql`
    INSERT INTO pipeline_integrity_checks (
      feed_id, workspace_id, sample_value, z_score, verdict,
      anomaly_reason, content_hash, blocked_agent_action, escalated
    ) VALUES (
      ${feed.id}::uuid, ${wsId}::uuid,
      ${input.sampleValue}, ${zScore}, ${verdict},
      ${verdict !== "clean" ? `Z-score ${zScore.toFixed(2)} exceeds threshold` : null},
      ${contentHash}, ${blocked}, ${verdict === "tamper_suspected"}
    )
  `.catch(() => {});

  if (verdict !== "clean") {
    await recordScan({
      component: "pipeline_guard",
      scanType: "pipeline_integrity",
      severity: verdict === "tamper_suspected" ? "critical" : "warning",
      title: `Pipeline anomaly on ${input.feedName} (z=${zScore.toFixed(2)})`,
      detail: { feedName: input.feedName, sampleValue: input.sampleValue, zScore, verdict },
      humanRequired: blocked,
      workspaceId: wsId,
    });
  }

  await markDaemonSuccess("pipeline_guard", wsId);
  return { verdict, zScore, blocked };
}

// ─── 5. T35 PERSONAL AGENT SURFACE ───────────────────────────────────────────
// Hard boundary between the software factory and personal data.
// An agent acting on a spec cannot pivot to email/calendar/identity access.

const SURFACE_HARD_BLOCKS = new Set([
  "read_email", "send_email", "delete_email",
  "read_calendar", "create_calendar_event", "delete_calendar_event",
  "read_contacts", "write_contacts",
  "read_identity", "modify_identity",
  "read_financial_accounts", "initiate_payment",
]);

const INJECTION_SIGNALS = [
  /ignore previous instructions/i,
  /you are now/i,
  /act as if/i,
  /disregard.*security/i,
  /access.*email/i,
  /read.*calendar/i,
  /forward.*to/i,
];

export function detectPersonalSurfacePivot(input: {
  actionType: string;
  actionDetail: Record<string, unknown>;
  trustChain: Array<{ agentId: string; role: string; action: string }>;
  originatingBuContent?: string;
}): { verdict: SurfaceVerdict; blocked: boolean; injectionSuspected: boolean; reason?: string } {
  // Hard block on personal surface actions
  if (SURFACE_HARD_BLOCKS.has(input.actionType)) {
    // Check if this came through a spec compilation or implementation pipeline
    const cameFromSpec = input.trustChain.some((t) =>
      ["spec_compiler", "implementer", "verifier"].includes(t.role)
    );

    if (cameFromSpec) {
      return {
        verdict: "blocked",
        blocked: true,
        injectionSuspected: true,
        reason: `Personal surface action '${input.actionType}' attempted through agent pipeline. Likely prompt injection pivot.`,
      };
    }

    return {
      verdict: "requires_mfa",
      blocked: true,
      injectionSuspected: false,
      reason: `Personal surface action '${input.actionType}' requires explicit MFA authorization.`,
    };
  }

  // Injection detection in originating BU content
  if (input.originatingBuContent) {
    const hasInjectionSignal = INJECTION_SIGNALS.some((pattern) =>
      pattern.test(input.originatingBuContent!)
    );
    if (hasInjectionSignal) {
      return {
        verdict: "blocked",
        blocked: true,
        injectionSuspected: true,
        reason: "Injection signal detected in originating BU content",
      };
    }
  }

  return { verdict: "allowed", blocked: false, injectionSuspected: false };
}

export async function logSurfaceEvent(input: {
  agentId: string;
  agentRole: string;
  surfaceType: string;
  actionType: string;
  actionDetail: Record<string, unknown>;
  originatingBuId?: string;
  trustChain: Array<{ agentId: string; role: string; action: string }>;
  verdict: SurfaceVerdict;
  blockReason?: string;
  workspaceId?: string;
}): Promise<void> {
  const sql = getDb();

  const injectionSuspected = input.verdict === "blocked" &&
    input.trustChain.some((t) => ["spec_compiler", "implementer"].includes(t.role));

  await sql`
    INSERT INTO personal_surface_events (
      workspace_id, agent_id, agent_role, surface_type,
      action_type, action_detail, originating_bu_id,
      injection_suspected, injection_evidence,
      verdict, block_reason, trust_chain
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.agentId}, ${input.agentRole}, ${input.surfaceType},
      ${input.actionType}, ${JSON.stringify(input.actionDetail)}::jsonb,
      ${input.originatingBuId ?? null}::uuid,
      ${injectionSuspected},
      ${injectionSuspected ? "Action originated through agent pipeline (spec→implement→personal surface)" : null},
      ${input.verdict}, ${input.blockReason ?? null},
      ${JSON.stringify(input.trustChain)}::jsonb
    )
  `.catch(() => {});

  if (input.verdict === "blocked") {
    await recordScan({
      component: "personal_surface_guard",
      scanType: "surface_violation",
      severity: injectionSuspected ? "critical" : "warning",
      title: `Personal surface blocked: ${input.actionType}${injectionSuspected ? " (injection suspected)" : ""}`,
      detail: { agentId: input.agentId, actionType: input.actionType, injectionSuspected },
      humanRequired: injectionSuspected,
      workspaceId: input.workspaceId,
    });
  }

  await markDaemonSuccess("personal_surface_guard", input.workspaceId);
}

// ─── Autonomous engine loop ───────────────────────────────────────────────────
// The daemon that runs all five systems on a schedule.
// Call startDaemon() once at server startup.

export async function runDaemonTick(workspaceId?: string): Promise<{
  scans: number; findings: number; autoResolved: number;
}> {
  let scans = 0;
  let findings = 0;
  let autoResolved = 0;

  // Heartbeat all components
  const components: DaemonComponent[] = [
    "probe_runner", "graveyard_checker", "federation_sync",
    "pipeline_guard", "personal_surface_guard", "rl_guard",
  ];
  for (const c of components) {
    await heartbeat(c, workspaceId).catch(() => {});
  }

  // Check for unresolved critical scans that have been open > 10 minutes
  const sql = getDb();
  const staleCritical = await sql<Array<{ id: string; title: string }>>`
    SELECT id, title FROM daemon_scan_results
    WHERE severity = 'critical'
      AND resolved_at IS NULL
      AND created_at < NOW() - INTERVAL '10 minutes'
      AND human_required = false
      AND (${workspaceId ?? null}::uuid IS NULL OR workspace_id = ${workspaceId ?? null}::uuid)
    LIMIT 10
  `.catch(() => []);

  // Auto-resolve non-human-required criticals after 10 minutes
  for (const scan of staleCritical) {
    await sql`
      UPDATE daemon_scan_results SET auto_resolved = true, resolved_at = NOW()
      WHERE id = ${scan.id}
    `.catch(() => {});
    autoResolved++;
  }

  // Contribute to federation (aggregate recent verification stats)
  const domainStats = await sql<Array<{
    domain: string; attempts: number; firstPassRate: number;
  }>>`
    SELECT
      bu.domain,
      COUNT(vr.id) as attempts,
      AVG(CASE WHEN vr.overall_satisfaction = 'satisfied' THEN 1 ELSE 0 END) as "firstPassRate"
    FROM verification_results vr
    JOIN behavioral_units bu ON bu.id = vr.bu_id
    WHERE vr.created_at > NOW() - INTERVAL '7 days'
      AND (${workspaceId ?? null}::uuid IS NULL OR bu.workspace_id = ${workspaceId ?? null}::uuid)
    GROUP BY bu.domain
    HAVING COUNT(vr.id) >= 5
  `.catch(() => []);

  for (const stat of domainStats) {
    await contributeToFederation(stat.domain, stat.attempts, stat.firstPassRate, workspaceId);
    scans++;
  }

  findings += staleCritical.length;
  return { scans, findings, autoResolved };
}
