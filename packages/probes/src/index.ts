/**
 * @forge/probes — Production behavioral probes.
 *
 * Deployed BUs become living SLAs. Their acceptance criteria are translated
 * into HTTP probes that run on schedule against your production URL.
 * Failures cascade through the intent graph, trigger reverification,
 * and surface in the chief-of-staff digest as escalations.
 *
 * The claim-to-reality gap closes permanently.
 */

import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@forge/db";
import { getBU, updateBUStatus, cascadeStatusChange } from "@forge/intent-graph";
import type {
  BehavioralUnit,
  AcceptanceCriterion,
  Constraint,
  InferredProbe,
  ProbeSchedule,
  ProbeResult,
  ProbeStatus,
} from "@forge/types";

const client = new Anthropic();

// ─── Probe inference ──────────────────────────────────────────────────────────
// Given a BU's claim + acceptance criteria, infer what HTTP requests to make.

const INFERENCE_SYSTEM = `You translate behavioral acceptance criteria into concrete HTTP probes.

For each criterion (given/when/then), output a JSON object with:
- criterionId: string (the criterion id passed in)
- method: GET | POST | PUT | DELETE | PATCH
- path: string — the URL path to call (e.g. "/api/auth/login")
- payload: object | null — request body for POST/PUT/PATCH
- expectedStatus: number[] — acceptable HTTP status codes (e.g. [200, 201])
- expectedBodyContains: string[] | null — strings that must appear in the response body
- expectedLatencyMs: number | null — maximum acceptable response time in ms (from constraints)
- rationale: string — one sentence explaining how this probe verifies the criterion

Rules:
- Use realistic paths based on the domain and claim
- For auth claims, probe /api/auth/... endpoints
- For billing claims, probe /api/billing/... or /api/subscriptions/...
- For user claims, probe /api/users/...
- A negative criterion ("returns 403 for non-admin") should probe WITH a non-admin token and expect 403
- A performance constraint threshold (< 200ms) should set expectedLatencyMs
- Respond ONLY with a JSON array of probe objects, no preamble`;

export async function inferProbesFromBU(bu: BehavioralUnit): Promise<InferredProbe[]> {
  if (bu.acceptanceCriteria.length === 0) {
    // Generate a basic smoke probe from the claim itself
    return [{
      criterionId: "smoke",
      method: "GET",
      path: inferPathFromClaim(bu.claim, bu.domain),
      expectedStatus: [200, 201, 204],
      rationale: `Smoke probe: verifies the ${bu.domain} system responds to requests related to: ${bu.claim.substring(0, 60)}`,
    }];
  }

  const perfConstraint = bu.constraints.find(
    (c) => c.type === "performance" && c.threshold
  );

  const prompt = `Behavioral claim: "${bu.claim}"
Domain: ${bu.domain}
${perfConstraint ? `Performance constraint: ${perfConstraint.text} (threshold: ${perfConstraint.threshold})` : ""}

Acceptance criteria to probe:
${bu.acceptanceCriteria.map((ac) =>
  `- ID: ${ac.id}
  Given: ${ac.given}
  When: ${ac.when}
  Then: ${ac.then}
  Critical: ${ac.critical}`
).join("\n")}

Output a JSON array of probe objects, one per criterion.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: INFERENCE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (!block || block.type !== "text") return fallbackProbes(bu);

    const raw = block.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as InferredProbe[];
    return Array.isArray(parsed) ? parsed : fallbackProbes(bu);
  } catch {
    return fallbackProbes(bu);
  }
}

function inferPathFromClaim(claim: string, domain: string): string {
  const lower = claim.toLowerCase();
  if (/login|sign.?in|authenticate/.test(lower)) return "/api/auth/login";
  if (/reset|password/.test(lower)) return "/api/auth/reset";
  if (/register|sign.?up/.test(lower)) return "/api/auth/register";
  if (/profile|account/.test(lower)) return "/api/users/me";
  if (/subscription|plan|billing/.test(lower)) return "/api/billing/subscription";
  if (/invoice/.test(lower)) return "/api/billing/invoices";
  if (/webhook/.test(lower)) return "/api/webhooks/health";
  return `/api/${domain}/health`;
}

function fallbackProbes(bu: BehavioralUnit): InferredProbe[] {
  return bu.acceptanceCriteria.map((ac) => ({
    criterionId: ac.id,
    method: "GET" as const,
    path: inferPathFromClaim(bu.claim, bu.domain),
    expectedStatus: [200],
    rationale: `Fallback probe for: ${ac.given} → ${ac.then}`,
  }));
}

// ─── Probe execution ──────────────────────────────────────────────────────────

export interface ProbeRunResult {
  criterionId: string;
  passed: boolean;
  responseStatus?: number;
  responseMs?: number;
  responseBody?: string;
  failureReason?: string;
}

export async function executeProbe(
  probe: InferredProbe,
  baseUrl: string,
  headers: Record<string, string> = {}
): Promise<ProbeRunResult> {
  const url = `${baseUrl.replace(/\/$/, "")}${probe.path}`;
  const start = Date.now();

  try {
    const init: RequestInit = {
      method: probe.method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Forge-Probe/0.1.0",
        ...headers,
      },
      signal: AbortSignal.timeout(15_000),
    };

    if (probe.payload && ["POST", "PUT", "PATCH"].includes(probe.method)) {
      init.body = JSON.stringify(probe.payload);
    }

    const res = await fetch(url, init);
    const responseMs = Date.now() - start;
    const body = await res.text().catch(() => "");
    const truncatedBody = body.substring(0, 2048);

    // Check status
    if (!probe.expectedStatus.includes(res.status)) {
      return {
        criterionId: probe.criterionId,
        passed: false,
        responseStatus: res.status,
        responseMs,
        responseBody: truncatedBody,
        failureReason: `Expected status ${probe.expectedStatus.join(" or ")}, got ${res.status}`,
      };
    }

    // Check latency
    if (probe.expectedLatencyMs && responseMs > probe.expectedLatencyMs) {
      return {
        criterionId: probe.criterionId,
        passed: false,
        responseStatus: res.status,
        responseMs,
        responseBody: truncatedBody,
        failureReason: `Response time ${responseMs}ms exceeded threshold of ${probe.expectedLatencyMs}ms`,
      };
    }

    // Check body contains
    if (probe.expectedBodyContains) {
      const missing = probe.expectedBodyContains.filter((s) => !body.includes(s));
      if (missing.length > 0) {
        return {
          criterionId: probe.criterionId,
          passed: false,
          responseStatus: res.status,
          responseMs,
          responseBody: truncatedBody,
          failureReason: `Response missing expected content: ${missing.join(", ")}`,
        };
      }
    }

    return {
      criterionId: probe.criterionId,
      passed: true,
      responseStatus: res.status,
      responseMs,
      responseBody: truncatedBody,
    };
  } catch (e) {
    const responseMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      criterionId: probe.criterionId,
      passed: false,
      responseMs,
      failureReason: msg.includes("timeout") ? `Probe timed out after 15s` : `Network error: ${msg}`,
    };
  }
}

// ─── Probe scheduler ──────────────────────────────────────────────────────────

export async function createProbeSchedule(
  buId: string,
  productionUrl: string,
  options: {
    intervalSeconds?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<ProbeSchedule> {
  const sql = getDb();
  const rows = await sql<ProbeSchedule[]>`
    INSERT INTO probe_schedules (id, bu_id, interval_seconds, production_url, headers, next_run_at)
    VALUES (
      ${uuidv4()},
      ${buId},
      ${options.intervalSeconds ?? 300},
      ${productionUrl},
      ${JSON.stringify(options.headers ?? {})}::jsonb,
      NOW()
    )
    ON CONFLICT (bu_id, production_url) DO UPDATE SET
      interval_seconds = EXCLUDED.interval_seconds,
      headers = EXCLUDED.headers,
      enabled = true,
      updated_at = NOW()
    RETURNING *
  `;
  if (!rows[0]) throw new Error("Failed to create probe schedule");
  return rows[0];
}

export async function getProbeSchedule(scheduleId: string): Promise<ProbeSchedule | null> {
  const sql = getDb();
  const rows = await sql<ProbeSchedule[]>`SELECT * FROM probe_schedules WHERE id = ${scheduleId}`;
  return rows[0] ?? null;
}

export async function listProbeSchedules(buId?: string): Promise<ProbeSchedule[]> {
  const sql = getDb();
  if (buId) {
    return sql<ProbeSchedule[]>`SELECT * FROM probe_schedules WHERE bu_id = ${buId} ORDER BY created_at DESC`;
  }
  return sql<ProbeSchedule[]>`SELECT * FROM probe_schedules ORDER BY next_run_at ASC`;
}

export async function disableProbeSchedule(scheduleId: string): Promise<void> {
  const sql = getDb();
  await sql`UPDATE probe_schedules SET enabled = false, updated_at = NOW() WHERE id = ${scheduleId}`;
}

// ─── Full probe run ───────────────────────────────────────────────────────────
// The main loop: fetch due schedules, run probes, persist results, cascade on failure.

export async function runDueProbes(): Promise<{
  ran: number;
  passed: number;
  failed: number;
  cascaded: string[];
}> {
  const sql = getDb();

  // Claim all due schedules atomically
  const due = await sql<Array<ProbeSchedule & { claim: string; domain: string }>>`
    UPDATE probe_schedules ps SET
      last_run_at = NOW(),
      next_run_at = NOW() + (interval_seconds * INTERVAL '1 second')
    FROM behavioral_units bu
    WHERE ps.bu_id = bu.id
      AND ps.enabled = true
      AND ps.next_run_at <= NOW()
    RETURNING ps.*, bu.claim, bu.domain
  `;

  if (due.length === 0) return { ran: 0, passed: 0, failed: 0, cascaded: [] };

  const cascaded: string[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const schedule of due) {
    const result = await runProbeForSchedule(schedule);
    totalPassed += result.passed;
    totalFailed += result.failed;

    if (result.failed > 0 && result.criticalFailure) {
      cascaded.push(schedule.buId);
    }
  }

  return { ran: due.length, passed: totalPassed, failed: totalFailed, cascaded };
}

interface ScheduleRunResult {
  passed: number;
  failed: number;
  criticalFailure: boolean;
}

async function runProbeForSchedule(
  schedule: ProbeSchedule & { claim: string; domain: string }
): Promise<ScheduleRunResult> {
  const sql = getDb();

  const bu = await getBU(schedule.buId);
  if (!bu) return { passed: 0, failed: 0, criticalFailure: false };

  const headers = (schedule.headers as Record<string, string>) ?? {};

  // Infer probes from acceptance criteria
  const probes = await inferProbesFromBU(bu as BehavioralUnit);

  let passed = 0;
  let failed = 0;
  let criticalFailure = false;

  for (const probe of probes) {
    const result = await executeProbe(probe, schedule.productionUrl, headers);

    // Find the matching criterion for metadata
    const criterion = bu.acceptanceCriteria.find((ac) => ac.id === probe.criterionId);

    // Persist result
    await sql`
      INSERT INTO probe_results (
        id, schedule_id, bu_id, criterion_id,
        criterion_given, criterion_when, criterion_then, critical,
        passed, response_status, response_body, response_ms,
        failure_reason, probe_url, probe_method, probe_payload, probed_at
      ) VALUES (
        ${uuidv4()}, ${schedule.id}, ${schedule.buId}, ${probe.criterionId},
        ${criterion?.given ?? probe.path}, ${criterion?.when ?? probe.method},
        ${criterion?.then ?? `returns ${probe.expectedStatus.join(" or ")}`},
        ${criterion?.critical ?? false},
        ${result.passed},
        ${result.responseStatus ?? null},
        ${result.responseBody ?? null},
        ${result.responseMs ?? null},
        ${result.failureReason ?? null},
        ${`${schedule.productionUrl}${probe.path}`},
        ${probe.method},
        ${probe.payload ? JSON.stringify(probe.payload) : null}::jsonb,
        NOW()
      )
    `;

    if (result.passed) {
      passed++;
    } else {
      failed++;
      if (criterion?.critical ?? false) {
        criticalFailure = true;
      }
    }
  }

  // Update consecutive_failures counter
  if (failed > 0) {
    await sql`
      UPDATE probe_schedules SET
        consecutive_failures = consecutive_failures + 1,
        updated_at = NOW()
      WHERE id = ${schedule.id}
    `;

    // Get updated failure count
    const [updated] = await sql<Array<{ consecutiveFailures: number }>>`
      SELECT consecutive_failures as "consecutiveFailures"
      FROM probe_schedules WHERE id = ${schedule.id}
    `;
    const failures = updated?.consecutiveFailures ?? 1;

    // Cascade on ≥3 consecutive failures (matching the verification agent threshold)
    if (failures >= 3) {
      await updateBUStatus(schedule.buId, "needs_reverification");
      await cascadeStatusChange(schedule.buId, "needs_reverification");

      // Create an autonomy gap / escalation for the CoS inbox
      const { recordGap } = await import("@forge/intent-graph");
      const { createEscalation } = await import("@forge/agents");

      const gap = await recordGap({
        buId: schedule.buId,
        agentId: "probe-runner",
        agentRole: "verifier",
        gapType: "failed_verification_3x",
        description: `Production probe failed ${failures} consecutive times against ${schedule.productionUrl}. ${failed}/${probes.length} criteria failing.`,
        agentAttempts: failures,
      });

      await createEscalation({
        gapId: gap.id,
        buId: schedule.buId,
        agentId: "probe-runner",
        priority: criticalFailure ? "immediate" : "morning_digest",
        ask: `"${(schedule as { claim: string }).claim.substring(0, 120)}" is failing in production (${failures} consecutive failures at ${schedule.productionUrl}). Is this a deployment issue or a claim that needs updating?`,
        context: `${failed}/${probes.length} probes failing. Critical failure: ${criticalFailure}. Consecutive failures: ${failures}.`,
      });
    }
  } else {
    // Reset consecutive failures on clean run
    await sql`
      UPDATE probe_schedules SET
        consecutive_failures = 0,
        updated_at = NOW()
      WHERE id = ${schedule.id}
    `;
  }

  return { passed, failed, criticalFailure };
}

// ─── Production health query ──────────────────────────────────────────────────

export interface ProductionHealth {
  buId: string;
  claim: string;
  domain: string;
  scheduleId: string;
  productionUrl: string;
  intervalSeconds: number;
  consecutiveFailures: number;
  lastRunAt?: string;
  nextRunAt: string;
  probesLastHour: number;
  failuresLastHour: number;
  healthStatus: ProbeStatus;
}

export async function getProductionHealth(buId?: string): Promise<ProductionHealth[]> {
  const sql = getDb();
  try {
    if (buId) {
      return sql<ProductionHealth[]>`SELECT * FROM v_production_health WHERE bu_id = ${buId}`;
    }
    return sql<ProductionHealth[]>`SELECT * FROM v_production_health ORDER BY health_status DESC, failures_last_hour DESC`;
  } catch {
    // View may not exist if migration 004 hasn't run
    return [];
  }
}

export async function getRecentProbeResults(
  buId: string,
  limit = 20
): Promise<ProbeResult[]> {
  const sql = getDb();
  return sql<ProbeResult[]>`
    SELECT * FROM probe_results
    WHERE bu_id = ${buId}
    ORDER BY probed_at DESC
    LIMIT ${limit}
  `;
}

// ─── Probe summary for digest ─────────────────────────────────────────────────

export async function getProbeDigestSummary(): Promise<{
  totalMonitored: number;
  healthy: number;
  degraded: number;
  critical: number;
  recentFailures: Array<{ claim: string; domain: string; url: string; consecutiveFailures: number }>;
}> {
  const health = await getProductionHealth();

  const healthy = health.filter((h) => h.healthStatus === "healthy").length;
  const degraded = health.filter((h) => h.healthStatus === "degraded").length;
  const critical = health.filter((h) => h.healthStatus === "critical").length;

  const recentFailures = health
    .filter((h) => h.consecutiveFailures > 0)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
    .slice(0, 5)
    .map((h) => ({
      claim: h.claim.substring(0, 80),
      domain: h.domain,
      url: h.productionUrl,
      consecutiveFailures: h.consecutiveFailures,
    }));

  return { totalMonitored: health.length, healthy, degraded, critical, recentFailures };
}
