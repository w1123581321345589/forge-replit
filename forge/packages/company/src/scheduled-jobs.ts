/**
 * Scheduled jobs engine.
 * Replaces hardcoded scheduler logic with a runtime-configurable system.
 * The Command Center can create/modify/disable schedules without code changes.
 */

import { getDb } from "@forge/db";

export type JobType =
  | "behavioral_discovery" | "graveyard_check" | "payroll_compute"
  | "cross_workspace_pairing" | "federation_sync" | "probe_run"
  | "prompt_sync" | "annotation_prune" | "digest_generate"
  | "pipeline_integrity" | "custom";

export interface ScheduledJob {
  id: string;
  workspaceId: string;
  workspaceSlug?: string;
  jobType: JobType;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  runCount: number;
  nextRunAt?: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
}

// ─── Cron parsing (5-field: min hour dom month dow) ──────────────────────────

export function parseCronExpression(cron: string): {
  minute: string; hour: string; dom: string; month: string; dow: string;
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${cron}" (expected 5 fields)`);
  return {
    minute: parts[0]!, hour: parts[1]!, dom: parts[2]!,
    month: parts[3]!, dow: parts[4]!,
  };
}

function matchesCronField(value: number, field: string, min: number, max: number): boolean {
  if (field === "*") return true;
  // Handle */n (every n)
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return (value - min) % step === 0;
  }
  // Handle ranges: 1-5
  if (field.includes("-")) {
    const [start, end] = field.split("-").map(Number);
    return value >= start! && value <= end!;
  }
  // Handle lists: 1,3,5
  if (field.includes(",")) {
    return field.split(",").map(Number).includes(value);
  }
  return parseInt(field, 10) === value;
}

export function isDue(cronExpression: string, now = new Date()): boolean {
  try {
    const { minute, hour, dom, month, dow } = parseCronExpression(cronExpression);
    return (
      matchesCronField(now.getMinutes(), minute, 0, 59) &&
      matchesCronField(now.getHours(), hour, 0, 23) &&
      matchesCronField(now.getDate(), dom, 1, 31) &&
      matchesCronField(now.getMonth() + 1, month, 1, 12) &&
      matchesCronField(now.getDay(), dow, 0, 6)
    );
  } catch {
    return false;
  }
}

export function getNextRunTime(cronExpression: string, after = new Date()): Date {
  // Walk forward minute by minute up to 1 year
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // start from next minute

  for (let i = 0; i < 525600; i++) { // 1 year of minutes
    if (isDue(cronExpression, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return new Date(after.getTime() + 7 * 24 * 60 * 60 * 1000); // fallback: 1 week
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createScheduledJob(input: {
  workspaceId?: string;
  jobType: JobType;
  cronExpression: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  createdBy?: string;
}): Promise<ScheduledJob> {
  const sql = getDb();
  parseCronExpression(input.cronExpression); // validate
  const nextRun = getNextRunTime(input.cronExpression);

  const rows = await sql<ScheduledJob[]>`
    INSERT INTO scheduled_jobs (
      workspace_id, job_type, cron_expression, name, description,
      config, created_by, next_run_at
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.jobType}, ${input.cronExpression},
      ${input.name}, ${input.description ?? null},
      ${JSON.stringify(input.config ?? {})}::jsonb,
      ${input.createdBy ?? "human"},
      ${nextRun.toISOString()}
    )
    RETURNING
      id, workspace_id as "workspaceId", job_type as "jobType",
      cron_expression as "cronExpression", timezone, enabled, config,
      last_run_at as "lastRunAt", last_success_at as "lastSuccessAt",
      last_error as "lastError", run_count as "runCount",
      next_run_at as "nextRunAt", name, description,
      created_by as "createdBy", created_at as "createdAt"
  `;
  if (!rows[0]) throw new Error("Failed to create scheduled job");
  return rows[0];
}

export async function getDueJobs(workspaceId?: string): Promise<ScheduledJob[]> {
  const sql = getDb();
  try {
    return sql<ScheduledJob[]>`
      SELECT
        sj.id, sj.workspace_id as "workspaceId", ws.slug as "workspaceSlug",
        sj.job_type as "jobType", sj.cron_expression as "cronExpression",
        sj.timezone, sj.enabled, sj.config,
        sj.last_run_at as "lastRunAt", sj.last_success_at as "lastSuccessAt",
        sj.last_error as "lastError", sj.run_count as "runCount",
        sj.next_run_at as "nextRunAt", sj.name, sj.description,
        sj.created_by as "createdBy", sj.created_at as "createdAt"
      FROM v_due_jobs sj
      JOIN workspaces ws ON ws.id = sj.workspace_id
      WHERE (${workspaceId ?? null}::uuid IS NULL OR sj.workspace_id = ${workspaceId ?? null}::uuid)
    `;
  } catch { return []; }
}

export async function listScheduledJobs(workspaceId?: string): Promise<ScheduledJob[]> {
  const sql = getDb();
  try {
    return sql<ScheduledJob[]>`
      SELECT
        sj.id, sj.workspace_id as "workspaceId", ws.slug as "workspaceSlug",
        sj.job_type as "jobType", sj.cron_expression as "cronExpression",
        sj.timezone, sj.enabled, sj.config,
        sj.last_run_at as "lastRunAt", sj.last_success_at as "lastSuccessAt",
        sj.last_error as "lastError", sj.run_count as "runCount",
        sj.next_run_at as "nextRunAt", sj.name, sj.description,
        sj.created_by as "createdBy", sj.created_at as "createdAt"
      FROM scheduled_jobs sj
      JOIN workspaces ws ON ws.id = sj.workspace_id
      WHERE (${workspaceId ?? null}::uuid IS NULL OR sj.workspace_id = ${workspaceId ?? null}::uuid)
      ORDER BY sj.next_run_at ASC NULLS LAST
    `;
  } catch { return []; }
}

export async function markJobRan(
  jobId: string,
  success: boolean,
  error?: string
): Promise<void> {
  const sql = getDb();
  try {
    const job = await sql<Array<{ cronExpression: string }>>`
      UPDATE scheduled_jobs SET
        last_run_at = NOW(),
        last_success_at = CASE WHEN ${success} THEN NOW() ELSE last_success_at END,
        last_error = ${error ?? null},
        run_count = run_count + 1,
        updated_at = NOW()
      WHERE id = ${jobId}
      RETURNING cron_expression as "cronExpression"
    `;
    if (job[0]) {
      const nextRun = getNextRunTime(job[0].cronExpression);
      await sql`UPDATE scheduled_jobs SET next_run_at = ${nextRun.toISOString()} WHERE id = ${jobId}`;
    }
  } catch { /* best-effort */ }
}

export async function toggleJob(jobId: string, enabled: boolean): Promise<void> {
  const sql = getDb();
  await sql`UPDATE scheduled_jobs SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${jobId}`;
}

export async function deleteScheduledJob(jobId: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM scheduled_jobs WHERE id = ${jobId}`;
}

// ─── Job dispatcher — called from scheduler tick ──────────────────────────────
// This replaces the hardcoded if(isWednesday) / if(isMondayMorning) logic.

export async function dispatchDueJobs(workspaceId?: string): Promise<{
  ran: number; succeeded: number; failed: number;
}> {
  const due = await getDueJobs(workspaceId);
  let succeeded = 0;
  let failed = 0;

  for (const job of due) {
    try {
      await executeJob(job);
      await markJobRan(job.id, true);
      succeeded++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await markJobRan(job.id, false, error);
      failed++;
    }
  }

  return { ran: due.length, succeeded, failed };
}

async function executeJob(job: ScheduledJob): Promise<void> {
  const cfg = job.config as Record<string, unknown>;

  switch (job.jobType) {
    case "graveyard_check": {
      const { checkGraveyardRevivals } = await import("./index.ts");
      await checkGraveyardRevivals(job.workspaceId);
      break;
    }
    case "payroll_compute": {
      const { getDb } = await import("@forge/db");
      const { computeWeeklyPayroll } = await import("./index.ts");
      const sql = getDb();
      const agents = await sql<Array<{ agentId: string; agentRole: string }>>`
        SELECT DISTINCT agent_id as "agentId", agent_role as "agentRole"
        FROM agent_timesheets WHERE date >= CURRENT_DATE - 14
          AND workspace_id = ${job.workspaceId}::uuid
      `.catch(() => []);
      for (const a of agents) {
        await computeWeeklyPayroll(a.agentId, a.agentRole, job.workspaceId).catch(() => {});
      }
      break;
    }
    case "cross_workspace_pairing": {
      const { scheduleWeeklyCrossPairings, runCrossPairingSession } = await import("./index.ts");
      const sessions = await scheduleWeeklyCrossPairings();
      for (const s of sessions) await runCrossPairingSession(s.id).catch(() => {});
      break;
    }
    case "federation_sync": {
      const { runDaemonTick } = await import("@forge/daemon");
      await runDaemonTick(job.workspaceId);
      break;
    }
    case "prompt_sync": {
      const { syncAllPromptTemplates } = await import("./prompt-templates.ts");
      await syncAllPromptTemplates(job.workspaceId);
      break;
    }
    case "annotation_prune": {
      const { pruneAnnotations } = await import("./context-budgets.ts");
      await pruneAnnotations(job.workspaceId);
      break;
    }
    case "probe_run": {
      const { runDueProbes } = await import("@forge/probes");
      await runDueProbes();
      break;
    }
    case "digest_generate": {
      const { ChiefOfStaffAgent } = await import("@forge/agents");
      const cos = new ChiefOfStaffAgent();
      await cos.generateDigest(job.workspaceId);
      break;
    }
    case "custom": {
      // Custom jobs are logged but not auto-executed — they surface in CoS inbox
      console.log(`[scheduler] Custom job "${job.name}" is due — surfacing in CoS inbox`);
      break;
    }
    default:
      break;
  }
}
