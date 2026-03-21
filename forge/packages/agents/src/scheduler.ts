import { ChiefOfStaffAgent } from "./index.ts";

// ─── Digest Scheduler ─────────────────────────────────────────────────────────
// Runs the chief-of-staff digest on schedule (default: 9am + 4pm local time)
// Invoke with: bun run packages/agents/src/scheduler.ts

interface ScheduleConfig {
  times: Array<{ hour: number; minute: number }>;
  timezone: string;
  onDigest?: (markdown: string) => Promise<void>;
  onError?: (error: Error) => void;
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  times: [
    { hour: 9, minute: 0 },
    { hour: 16, minute: 0 },
  ],
  timezone: process.env["TZ"] ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
};

// ─── Next run calculator ──────────────────────────────────────────────────────

function getNextRunMs(times: Array<{ hour: number; minute: number }>): number {
  const now = new Date();
  const candidates = times.map(({ hour, minute }) => {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  });
  return Math.min(...candidates);
}

function formatNextRun(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ─── Webhook delivery (optional) ─────────────────────────────────────────────

async function deliverDigest(markdown: string, config: ScheduleConfig): Promise<void> {
  // Slack webhook
  const slackUrl = process.env["FORGE_SLACK_WEBHOOK"];
  if (slackUrl) {
    try {
      await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*Forge Digest — ${new Date().toLocaleDateString()}*`,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: markdown.substring(0, 3000) },
            },
          ],
        }),
      });
      console.log("[scheduler] Digest delivered to Slack");
    } catch (e) {
      console.error("[scheduler] Slack delivery failed:", e);
    }
  }

  // Email (via API)
  const forgeApi = process.env["FORGE_API"] ?? "http://localhost:3000";
  const emailTo = process.env["FORGE_DIGEST_EMAIL"];
  if (emailTo) {
    try {
      await fetch(`${forgeApi}/api/digest/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailTo, markdown }),
      });
      console.log(`[scheduler] Digest emailed to ${emailTo}`);
    } catch (e) {
      console.error("[scheduler] Email delivery failed:", e);
    }
  }

  // Custom handler
  if (config.onDigest) {
    await config.onDigest(markdown);
  }
}

// ─── Scheduler loop ───────────────────────────────────────────────────────────

export async function startScheduler(config: Partial<ScheduleConfig> = {}): Promise<void> {
  const cfg: ScheduleConfig = { ...DEFAULT_SCHEDULE, ...config };
  const cos = new ChiefOfStaffAgent();

  console.log(`[scheduler] Starting Forge digest scheduler`);
  console.log(`[scheduler] Schedule: ${cfg.times.map((t) => `${t.hour}:${String(t.minute).padStart(2, "0")}`).join(", ")} (${cfg.timezone})`);

  async function runDigest(): Promise<void> {
    const ts = new Date().toISOString();
    console.log(`[scheduler] ${ts} — generating digest`);
    try {
      const digest = await cos.generateDigest();
      const markdown = await cos.formatDigestMarkdown(digest);
      console.log(`[scheduler] Digest generated: ${digest.shippedSinceLastDigest.length} shipped, ${digest.stuck.length} stuck`);
      await deliverDigest(markdown, cfg);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[scheduler] Digest failed:", err.message);
      cfg.onError?.(err);
    }
  }

  // Check if we should run immediately (e.g. first startup)
  const shouldRunImmediately = process.env["FORGE_DIGEST_NOW"] === "true";
  if (shouldRunImmediately) {
    await runDigest();
  }

  // Probe runner loop — checks for due probes every 60 seconds
  async function runProbes(): Promise<void> {
    try {
      const { runDueProbes } = await import("@forge/probes");
      const result = await runDueProbes();
      if (result.ran > 0) {
        console.log(`[scheduler] Probes: ${result.ran} ran, ${result.passed} passed, ${result.failed} failed${result.cascaded.length > 0 ? `, ${result.cascaded.length} cascaded` : ""}`);
      }
    } catch {
      // @forge/probes may not be installed or migration 004 not applied yet — silent
    }
  }

  // Company ops loop — weekly payroll, Wednesday pairings, daily graveyard check
  async function runCompanyOps(): Promise<void> {
    try {
      const {
        computeWeeklyPayroll, scheduleWeeklyCrossPairings,
        checkGraveyardRevivals, runCrossPairingSession,
      } = await import("@forge/company");
      const { getDb } = await import("@forge/db");
      const sql = getDb();

      const now = new Date();
      const isWednesday = now.getDay() === 3;
      const isMondayMorning = now.getDay() === 1 && now.getHours() === 8;
      const isSundayEvening = now.getDay() === 0 && now.getHours() === 20;

      // Wednesday: schedule cross-workspace pairings
      if (isWednesday && now.getHours() === 10 && now.getMinutes() < 5) {
        const sessions = await scheduleWeeklyCrossPairings();
        if (sessions.length > 0) {
          console.log(`[scheduler] ☕ Scheduled ${sessions.length} cross-workspace coffee pairings`);
          // Run them immediately
          for (const session of sessions) {
            const result = await runCrossPairingSession(session.id);
            console.log(`[scheduler] ☕ Pairing complete: ${result.insights.length} insights, ${result.annotationsCreated} annotations`);
          }
        }
      }

      // Monday: compute weekly payroll for all active agents
      if (isMondayMorning) {
        const agentRows = await sql<Array<{ agentId: string; agentRole: string; workspaceId: string }>>`
          SELECT DISTINCT
            agent_id as "agentId", agent_role as "agentRole",
            workspace_id as "workspaceId"
          FROM agent_timesheets
          WHERE date >= CURRENT_DATE - 14
        `.catch(() => []);

        for (const agent of agentRows) {
          await computeWeeklyPayroll(agent.agentId, agent.agentRole, agent.workspaceId).catch(() => {});
        }
        if (agentRows.length > 0) {
          console.log(`[scheduler] 💰 Computed payroll for ${agentRows.length} agents`);
        }
      }

      // Sunday evening: check graveyard for revival candidates
      if (isSundayEvening) {
        const revivals = await checkGraveyardRevivals();
        if (revivals.length > 0) {
          console.log(`[scheduler] 🪦 ${revivals.length} idea(s) in graveyard ready for revival — check CoS inbox`);
          // Create CoS escalations for revival candidates
          const { createEscalation, recordGap } = await import("@forge/intent-graph");
          for (const idea of revivals) {
            const gap = await recordGap({
              buId: idea.workspaceId, // best available ID
              agentId: "graveyard-checker",
              agentRole: "chief_of_staff",
              gapType: "human_taste",
              description: `Graveyard revival candidate: "${idea.title}" — ${idea.revivalConditions}`,
            }).catch(() => null);
            if (gap) {
              await createEscalation({
                gapId: gap.id,
                buId: idea.workspaceId,
                agentId: "graveyard-checker",
                priority: "morning_digest",
                ask: `"${idea.title}" was rejected ${Math.floor((Date.now() - new Date(idea.rejectedAt).getTime()) / 86400000)} days ago with revival condition: "${idea.revivalConditions}". Ready to attempt now?`,
                context: `Domain: ${idea.domain}. Original rejection: ${idea.rejectionReason}`,
              }).catch(() => {});
            }
          }
        }
      }
    } catch {
      // @forge/company not available or migrations not applied yet
    }
  }

  // Start probe loop in background (non-blocking)
  const probeLoop = async () => {
    while (true) {
      await runProbes();
      await Bun.sleep(60_000); // check every minute
    }
  };
  probeLoop().catch((e) => console.error("[scheduler] Probe loop error:", e));

  // Company ops loop — runs every 5 minutes (like the Swarm Worker heartbeat)
  const companyOpsLoop = async () => {
    while (true) {
      await runCompanyOps();
      await Bun.sleep(300_000); // every 5 minutes
    }
  };
  companyOpsLoop().catch((e) => console.error("[scheduler] Company ops loop error:", e));

  // Autonomous daemon engine — federation, pipeline guard, RL guard, surface guard
  const daemonLoop = async () => {
    while (true) {
      try {
        const { runDaemonTick } = await import("@forge/daemon");
        const result = await runDaemonTick();
        if (result.findings > 0 || result.autoResolved > 0) {
          console.log(`[daemon] ${result.scans} scans, ${result.findings} findings, ${result.autoResolved} auto-resolved`);
        }
      } catch { /* migration 009 not applied yet */ }
      await Bun.sleep(300_000); // every 5 minutes
    }
  };
  daemonLoop().catch((e) => console.error("[daemon] loop error:", e));

  // Digest schedule loop
  while (true) {
    const nextMs = getNextRunMs(cfg.times);
    console.log(`[scheduler] Next digest in ${formatNextRun(nextMs)}`);
    await Bun.sleep(nextMs);
    await runDigest();
  }
}

// ─── Test generator ───────────────────────────────────────────────────────────
// Generates a complete Bun test suite from VerificationAssertions

export function generateBunTestSuite(
  buId: string,
  claim: string,
  assertions: Array<{
    id: string;
    assertionType: string;
    given: string;
    expectedBehavior: string;
    testCode?: string;
    claimFragment: string;
  }>
): string {
  const lines: string[] = [
    `import { test, expect, describe } from "bun:test";`,
    ``,
    `// Auto-generated verification suite for BU: ${buId.substring(0, 8)}`,
    `// Claim: "${claim.substring(0, 80)}"`,
    `// Generated: ${new Date().toISOString()}`,
    `// WARNING: Do not edit manually — regenerated on each verification cycle`,
    ``,
    `describe("BU ${buId.substring(0, 8)} — ${claim.substring(0, 50)}", () => {`,
  ];

  for (const assertion of assertions) {
    const testName = `[${assertion.assertionType}] Given ${assertion.given.substring(0, 40)}, expects ${assertion.expectedBehavior.substring(0, 40)}`;

    lines.push(`  test(${JSON.stringify(testName)}, async () => {`);
    lines.push(`    // Claim fragment: ${assertion.claimFragment}`);

    if (assertion.testCode) {
      // Indent the provided test code
      const indented = assertion.testCode
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n");
      lines.push(indented);
    } else {
      // Generate a placeholder based on assertion type
      lines.push(`    // TODO: Implement test for: ${assertion.expectedBehavior}`);
      lines.push(`    // Given: ${assertion.given}`);

      switch (assertion.assertionType) {
        case "performance":
          lines.push(`    const start = Date.now();`);
          lines.push(`    // await yourFunction();`);
          lines.push(`    const duration = Date.now() - start;`);
          lines.push(`    expect(duration).toBeLessThan(200); // adjust threshold`);
          break;
        case "security":
          lines.push(`    // Test that malicious input is rejected`);
          lines.push(`    // expect(() => yourFunction(maliciousInput)).toThrow();`);
          lines.push(`    expect(true).toBe(true); // replace with actual security assertion`);
          break;
        case "idempotency":
          lines.push(`    // const result1 = await yourFunction(input);`);
          lines.push(`    // const result2 = await yourFunction(input);`);
          lines.push(`    // expect(result1).toEqual(result2);`);
          lines.push(`    expect(true).toBe(true); // replace with idempotency check`);
          break;
        default:
          lines.push(`    // expect(yourFunction(input)).toEqual(expectedOutput);`);
          lines.push(`    expect(true).toBe(true); // replace with actual assertion`);
      }
    }

    lines.push(`  });`);
    lines.push(``);
  }

  lines.push(`});`);
  return lines.join("\n");
}

// ─── Git bridge — import infers BUs from existing code ────────────────────────

export interface InferredBU {
  claim: string;
  domain: string;
  confidence: number;
  sourceFile: string;
  sourceLine?: number;
}

export async function inferBUsFromCode(fileContents: Array<{ path: string; content: string }>): Promise<InferredBU[]> {
  const inferred: InferredBU[] = [];

  for (const file of fileContents) {
    // Extract domain from file path
    const domain = inferDomainFromPath(file.path);

    // Look for JSDoc/TSDoc comments that describe behavior
    const docCommentPattern = /\/\*\*[\s\S]*?\*\//g;
    const matches = file.content.matchAll(docCommentPattern);

    for (const match of matches) {
      const comment = match[0];
      // Extract the main description (first non-tag line)
      const descLine = comment
        .split("\n")
        .find((l) => l.includes("*") && !l.includes("@") && !l.includes("/**"))
        ?.replace(/\s*\*\s*/, "")
        .trim();

      if (descLine && descLine.length > 20 && descLine.length < 300) {
        inferred.push({
          claim: descLine,
          domain,
          confidence: 0.6,
          sourceFile: file.path,
        });
      }
    }

    // Look for exported function names as behavioral hints
    const exportedFunctions = file.content.matchAll(
      /export\s+(?:async\s+)?function\s+(\w+)/g
    );
    for (const match of exportedFunctions) {
      const funcName = match[1] ?? "";
      if (funcName.length > 3) {
        // Convert camelCase to claim: "createUser" → "System can create users"
        const words = funcName.replace(/([A-Z])/g, " $1").toLowerCase().trim();
        const claim = `System can ${words}`;
        inferred.push({
          claim,
          domain,
          confidence: 0.4, // Low confidence — needs human review
          sourceFile: file.path,
        });
      }
    }
  }

  // Deduplicate by claim similarity (simple exact dedup for now)
  const seen = new Set<string>();
  return inferred.filter((bu) => {
    const key = bu.claim.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferDomainFromPath(filePath: string): string {
  const path = filePath.toLowerCase();
  const domainMap: Array<[RegExp, string]> = [
    [/auth|login|session|token|jwt|oauth/, "auth"],
    [/billing|payment|stripe|invoice|subscription/, "billing"],
    [/user|profile|account/, "users"],
    [/api|route|endpoint|controller/, "api"],
    [/db|database|migration|schema|model/, "data"],
    [/email|notify|notification|webhook/, "notifications"],
    [/search|query|index/, "search"],
    [/file|upload|storage|s3/, "storage"],
  ];
  for (const [pattern, domain] of domainMap) {
    if (pattern.test(path)) return domain;
  }
  // Fall back to directory name
  const parts = filePath.split("/");
  return parts.length > 1 ? (parts[parts.length - 2] ?? "general") : "general";
}

// Entry point
if (import.meta.main) {
  await startScheduler();
}
