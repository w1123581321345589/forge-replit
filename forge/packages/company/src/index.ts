/**
 * @forge/company — Company operations layer for AI agent teams.
 *
 * Five systems that turn a pipeline into a company:
 *
 * 1. Attendance    — agents prove what they did (evidence_refs)
 * 2. Payroll       — behavioral signal drives config changes
 * 3. Messaging     — structured inter-agent protocol, required acks
 * 4. Pairing       — cross-workspace knowledge exchange
 * 5. Graveyard     — rejected ideas with revival conditions
 *
 * "Attendance, payroll, performance reviews sound like over-engineering.
 *  They're actually the last line of defense for agent reliability."
 *                                              — @Voxyz_ai
 */

import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@forge/db";
import { recordAnnotation } from "@forge/intent-graph";
import type { EvidenceRef } from "@forge/agents";

const client = new Anthropic();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Timesheet {
  id: string;
  agentId: string;
  agentRole: string;
  workspaceId: string;
  date: string;
  primaryWorkBlocks: number;
  secondaryWorkBlocks: number;
  improvementBlocks: number;
  breakBlocks: number;
  evidenceRefs: EvidenceRef[];
  summary?: string;
  blockers?: string;
  reviewed: boolean;
  createdAt: string;
}

export interface PayrollEntry {
  id: string;
  agentId: string;
  agentRole: string;
  workspaceId: string;
  weekStart: string;
  weekEnd: string;
  baseSalary: number;
  shippedBuBonus: number;
  closedGapBonus: number;
  timelyEvidenceBonus: number;
  missingTimesheetPenalty: number;
  openLoopPenalty: number;
  hardbanViolationPenalty: number;
  totalCredits: number;
  consecutiveLowWeeks: number;
}

export type MessageType = "question" | "reply" | "opinion" | "challenge" | "agreement" | "handoff" | "insight" | "alert";
export type MessageSentiment = "positive" | "negative" | "curious" | "frustrated" | "supportive" | "critical" | "neutral";

export interface AgentMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: string;
  targetAgentId?: string;
  workspaceId: string;
  messageType: MessageType;
  sentiment: MessageSentiment;
  content: string;
  buId?: string;
  status: "draft" | "sent" | "acknowledged" | "closed";
  acknowledgedAt?: string;
  producedInsight: boolean;
  createdAt: string;
}

export interface CrossWorkspaceSession {
  id: string;
  sessionType: "random_coffee" | "demo_day" | "incident_review" | "strategy_sync";
  agentAId: string;
  agentARole: string;
  workspaceA: string;
  agentBId: string;
  agentBRole: string;
  workspaceB: string;
  topic?: string;
  insightsProduced: number;
  scheduledFor: string;
  completedAt?: string;
}

export interface GraveyardEntry {
  id: string;
  workspaceId: string;
  title: string;
  specText: string;
  domain: string;
  rejectedAt: string;
  rejectedBy: string;
  rejectionReason: string;
  revivalConditions: string;
  revivalTriggers: Array<{ type: string; signal: string; threshold?: string }>;
  revived: boolean;
}

// ─── 1. ATTENDANCE ────────────────────────────────────────────────────────────

export async function submitTimesheet(input: {
  agentId: string;
  agentRole: string;
  workspaceId?: string;
  primaryWorkBlocks: number;
  secondaryWorkBlocks: number;
  improvementBlocks: number;
  breakBlocks: number;
  evidenceRefs: EvidenceRef[];
  summary?: string;
  blockers?: string;
}): Promise<Timesheet> {
  const sql = getDb();

  // Validate blocks sum to 8
  const total = input.primaryWorkBlocks + input.secondaryWorkBlocks +
    input.improvementBlocks + input.breakBlocks;
  if (total !== 8) {
    throw new Error(`Timesheet blocks must sum to 8, got ${total}`);
  }

  // Validate evidence on claimed work
  if (input.primaryWorkBlocks > 0 && input.evidenceRefs.length === 0) {
    throw new Error(
      "Agents claiming primary work must provide evidence_refs. " +
      "An empty evidence_refs on a claimed success is a silent failure."
    );
  }

  const rows = await sql<Timesheet[]>`
    INSERT INTO agent_timesheets (
      agent_id, agent_role, workspace_id, date,
      primary_work_blocks, secondary_work_blocks, improvement_blocks, break_blocks,
      evidence_refs, summary, blockers
    ) VALUES (
      ${input.agentId}, ${input.agentRole},
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"},
      CURRENT_DATE,
      ${input.primaryWorkBlocks}, ${input.secondaryWorkBlocks},
      ${input.improvementBlocks}, ${input.breakBlocks},
      ${JSON.stringify(input.evidenceRefs)}::jsonb,
      ${input.summary ?? null}, ${input.blockers ?? null}
    )
    ON CONFLICT (agent_id, date) DO UPDATE SET
      primary_work_blocks = EXCLUDED.primary_work_blocks,
      secondary_work_blocks = EXCLUDED.secondary_work_blocks,
      improvement_blocks = EXCLUDED.improvement_blocks,
      break_blocks = EXCLUDED.break_blocks,
      evidence_refs = EXCLUDED.evidence_refs,
      summary = EXCLUDED.summary,
      blockers = EXCLUDED.blockers,
      updated_at = NOW()
    RETURNING *
  `;
  if (!rows[0]) throw new Error("Failed to submit timesheet");
  return rows[0];
}

export async function getTimesheets(options: {
  workspaceId?: string;
  agentId?: string;
  startDate?: string;
  reviewedOnly?: boolean;
} = {}): Promise<Timesheet[]> {
  const sql = getDb();
  try {
    const rows = await sql<Timesheet[]>`
      SELECT
        id, agent_id as "agentId", agent_role as "agentRole",
        workspace_id as "workspaceId", date,
        primary_work_blocks as "primaryWorkBlocks",
        secondary_work_blocks as "secondaryWorkBlocks",
        improvement_blocks as "improvementBlocks",
        break_blocks as "breakBlocks",
        evidence_refs as "evidenceRefs",
        summary, blockers, reviewed,
        created_at as "createdAt"
      FROM agent_timesheets
      WHERE (${options.workspaceId ?? null}::uuid IS NULL OR workspace_id = ${options.workspaceId ?? null}::uuid)
        AND (${options.agentId ?? null}::text IS NULL OR agent_id = ${options.agentId ?? null})
        AND date >= ${options.startDate ?? new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]}
      ORDER BY date DESC, agent_id
    `;
    return rows;
  } catch { return []; }
}

export async function getMissingTimesheets(workspaceId?: string): Promise<Array<{
  agentId: string; agentRole: string; missingDates: string[];
}>> {
  const sql = getDb();
  try {
    // Find agents that submitted at least once in the last 30 days but missed recent days
    const recent = await sql<Array<{ agentId: string; agentRole: string; dates: string[] }>>`
      SELECT
        agent_id as "agentId", agent_role as "agentRole",
        array_agg(date::text ORDER BY date DESC) as dates
      FROM agent_timesheets
      WHERE date >= CURRENT_DATE - 7
        AND (${workspaceId ?? null}::uuid IS NULL OR workspace_id = ${workspaceId ?? null}::uuid)
      GROUP BY agent_id, agent_role
    `;

    const expected = Array.from({ length: 5 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split("T")[0]!;
    });

    return recent.map((a) => ({
      agentId: a.agentId,
      agentRole: a.agentRole,
      missingDates: expected.filter((d) => !a.dates.includes(d)),
    })).filter((a) => a.missingDates.length > 0);
  } catch { return []; }
}

// ─── 2. PAYROLL ───────────────────────────────────────────────────────────────

export async function computeWeeklyPayroll(
  agentId: string,
  agentRole: string,
  workspaceId?: string
): Promise<PayrollEntry> {
  const sql = getDb();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const wsId = workspaceId ?? "00000000-0000-0000-0000-000000000001";

  // Count shipped BUs this week
  const shippedRows = await sql<Array<{ count: number }>>`
    SELECT COUNT(*) as count FROM verification_results vr
    JOIN behavioral_units bu ON bu.id = vr.bu_id
    WHERE vr.verifier_agent_id = ${agentId}
      AND vr.overall_satisfaction = 'satisfied'
      AND vr.created_at BETWEEN ${weekStart.toISOString()} AND ${weekEnd.toISOString()}
      AND bu.workspace_id = ${wsId}::uuid
  `.catch(() => [{ count: 0 }]);
  const shippedBUs = Number(shippedRows[0]?.count ?? 0);

  // Count closed gaps
  const closedGapRows = await sql<Array<{ count: number }>>`
    SELECT COUNT(*) as count FROM autonomy_gaps ag
    JOIN behavioral_units bu ON bu.id = ag.bu_id
    WHERE ag.resolved_by = ${agentId}
      AND ag.resolved_at BETWEEN ${weekStart.toISOString()} AND ${weekEnd.toISOString()}
      AND bu.workspace_id = ${wsId}::uuid
  `.catch(() => [{ count: 0 }]);
  const closedGaps = Number(closedGapRows[0]?.count ?? 0);

  // Count timesheets with evidence
  const tsRows = await sql<Array<{ withEvidence: number; total: number }>>`
    SELECT
      COUNT(*) FILTER (WHERE jsonb_array_length(evidence_refs) > 0) as "withEvidence",
      COUNT(*) as total
    FROM agent_timesheets
    WHERE agent_id = ${agentId}
      AND workspace_id = ${wsId}::uuid
      AND date BETWEEN ${weekStart.toISOString().split("T")[0]} AND ${weekEnd.toISOString().split("T")[0]}
  `.catch(() => [{ withEvidence: 0, total: 0 }]);

  const withEvidence = Number(tsRows[0]?.withEvidence ?? 0);
  const totalTs = Number(tsRows[0]?.total ?? 0);
  const missingTs = Math.max(0, 5 - totalTs); // 5 work days

  // Count hardban violations
  const banRows = await sql<Array<{ count: number }>>`
    SELECT COUNT(*) as count FROM agent_ban_violations
    WHERE agent_id = ${agentId}
      AND workspace_id = ${wsId}::uuid
      AND created_at BETWEEN ${weekStart.toISOString()} AND ${weekEnd.toISOString()}
  `.catch(() => [{ count: 0 }]);
  const banViolations = Number(banRows[0]?.count ?? 0);

  // Count stale escalations (open loops > 48h)
  const staleRows = await sql<Array<{ count: number }>>`
    SELECT COUNT(*) as count FROM escalation_events ee
    JOIN behavioral_units bu ON bu.id = ee.bu_id
    WHERE ee.agent_id = ${agentId}
      AND ee.resolved_at IS NULL
      AND ee.created_at < NOW() - INTERVAL '48 hours'
      AND bu.workspace_id = ${wsId}::uuid
  `.catch(() => [{ count: 0 }]);
  const openLoops = Number(staleRows[0]?.count ?? 0);

  // Get consecutive low weeks
  const prevRows = await sql<Array<{ consecutiveLowWeeks: number }>>`
    SELECT consecutive_low_weeks as "consecutiveLowWeeks"
    FROM agent_payroll
    WHERE agent_id = ${agentId} AND workspace_id = ${wsId}::uuid
    ORDER BY week_start DESC LIMIT 1
  `.catch(() => [{ consecutiveLowWeeks: 0 }]);
  const prevLowWeeks = prevRows[0]?.consecutiveLowWeeks ?? 0;

  const shippedBonus = shippedBUs * 10;
  const gapBonus = closedGaps * 5;
  const evidenceBonus = withEvidence * 2;
  const tsPenalty = missingTs * 15;
  const loopPenalty = openLoops * 5;
  const banPenalty = banViolations * 20;
  const total = 100 + shippedBonus + gapBonus + evidenceBonus - tsPenalty - loopPenalty - banPenalty;
  const isLow = total < 80;

  const rows = await sql<PayrollEntry[]>`
    INSERT INTO agent_payroll (
      agent_id, agent_role, workspace_id, week_start, week_end,
      base_salary, shipped_bu_bonus, closed_gap_bonus, timely_evidence_bonus,
      missing_timesheet_penalty, open_loop_penalty, hardban_violation_penalty,
      consecutive_low_weeks
    ) VALUES (
      ${agentId}, ${agentRole}, ${wsId}::uuid,
      ${weekStart.toISOString().split("T")[0]},
      ${weekEnd.toISOString().split("T")[0]},
      100, ${shippedBonus}, ${gapBonus}, ${evidenceBonus},
      ${tsPenalty}, ${loopPenalty}, ${banPenalty},
      ${isLow ? prevLowWeeks + 1 : 0}
    )
    ON CONFLICT (agent_id, week_start) DO UPDATE SET
      shipped_bu_bonus = EXCLUDED.shipped_bu_bonus,
      closed_gap_bonus = EXCLUDED.closed_gap_bonus,
      timely_evidence_bonus = EXCLUDED.timely_evidence_bonus,
      missing_timesheet_penalty = EXCLUDED.missing_timesheet_penalty,
      open_loop_penalty = EXCLUDED.open_loop_penalty,
      hardban_violation_penalty = EXCLUDED.hardban_violation_penalty,
      consecutive_low_weeks = EXCLUDED.consecutive_low_weeks,
      computed_at = NOW()
    RETURNING
      id, agent_id as "agentId", agent_role as "agentRole",
      workspace_id as "workspaceId", week_start as "weekStart", week_end as "weekEnd",
      base_salary as "baseSalary",
      shipped_bu_bonus as "shippedBuBonus", closed_gap_bonus as "closedGapBonus",
      timely_evidence_bonus as "timelyEvidenceBonus",
      missing_timesheet_penalty as "missingTimesheetPenalty",
      open_loop_penalty as "openLoopPenalty",
      hardban_violation_penalty as "hardbanViolationPenalty",
      total_credits as "totalCredits",
      consecutive_low_weeks as "consecutiveLowWeeks"
  `;

  const entry = rows[0];
  if (!entry) throw new Error("Failed to compute payroll");

  // Trigger role review if 3 consecutive low weeks
  if (entry.consecutiveLowWeeks >= 3) {
    await triggerRoleReview(agentId, agentRole, wsId, {
      type: "scope_narrowing",
      reason: `${entry.consecutiveLowWeeks} consecutive weeks below 80 credits`,
      evidence: { weekStart: entry.weekStart, totalCredits: entry.totalCredits },
    });
  }

  return entry;
}

async function triggerRoleReview(
  agentId: string, agentRole: string, workspaceId: string,
  config: { type: string; reason: string; evidence: unknown }
) {
  const sql = getDb();
  await sql`
    INSERT INTO agent_role_reviews (
      agent_id, agent_role, workspace_id, review_type, trigger_reason, evidence
    ) VALUES (
      ${agentId}, ${agentRole}, ${workspaceId}::uuid,
      ${config.type}, ${config.reason},
      ${JSON.stringify(config.evidence)}::jsonb
    )
  `.catch(() => {}); // best-effort
}

export async function getPayrollSummary(workspaceId?: string): Promise<PayrollEntry[]> {
  const sql = getDb();
  try {
    const wsFilter = workspaceId ? sql`AND workspace_id = ${workspaceId}::uuid` : sql``;
    return sql<PayrollEntry[]>`
      SELECT
        id, agent_id as "agentId", agent_role as "agentRole",
        workspace_id as "workspaceId", week_start as "weekStart", week_end as "weekEnd",
        base_salary as "baseSalary", shipped_bu_bonus as "shippedBuBonus",
        closed_gap_bonus as "closedGapBonus", timely_evidence_bonus as "timelyEvidenceBonus",
        missing_timesheet_penalty as "missingTimesheetPenalty",
        open_loop_penalty as "openLoopPenalty",
        hardban_violation_penalty as "hardbanViolationPenalty",
        total_credits as "totalCredits",
        consecutive_low_weeks as "consecutiveLowWeeks"
      FROM agent_payroll
      WHERE week_start >= DATE_TRUNC('week', NOW())::date ${wsFilter}
      ORDER BY total_credits ASC
    `;
  } catch { return []; }
}

// ─── 3. INTER-AGENT MESSAGING ─────────────────────────────────────────────────

export async function sendMessage(input: {
  senderId: string;
  senderRole: string;
  targetAgentId?: string;
  workspaceId?: string;
  messageType: MessageType;
  sentiment: MessageSentiment;
  content: string;
  buId?: string;
  conversationId?: string;
}): Promise<AgentMessage> {
  const sql = getDb();
  const rows = await sql<AgentMessage[]>`
    INSERT INTO agent_messages (
      id, conversation_id, sender_id, sender_role, target_agent_id,
      workspace_id, message_type, sentiment, content, bu_id, status
    ) VALUES (
      ${uuidv4()},
      ${input.conversationId ?? uuidv4()},
      ${input.senderId}, ${input.senderRole},
      ${input.targetAgentId ?? null},
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"},
      ${input.messageType}, ${input.sentiment},
      ${input.content},
      ${input.buId ?? null},
      'sent'
    )
    RETURNING
      id, conversation_id as "conversationId",
      sender_id as "senderId", sender_role as "senderRole",
      target_agent_id as "targetAgentId", workspace_id as "workspaceId",
      message_type as "messageType", sentiment,
      content, bu_id as "buId", status,
      acknowledged_at as "acknowledgedAt",
      produced_insight as "producedInsight",
      created_at as "createdAt"
  `;
  if (!rows[0]) throw new Error("Failed to send message");
  return rows[0];
}

export async function acknowledgeMessage(messageId: string, agentId: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE agent_messages
    SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = ${agentId}
    WHERE id = ${messageId}
  `;
}

export async function getPendingMessages(agentId: string, workspaceId?: string): Promise<AgentMessage[]> {
  const sql = getDb();
  try {
    return sql<AgentMessage[]>`
      SELECT
        id, conversation_id as "conversationId",
        sender_id as "senderId", sender_role as "senderRole",
        message_type as "messageType", sentiment,
        content, bu_id as "buId", status,
        created_at as "createdAt"
      FROM agent_messages
      WHERE (target_agent_id = ${agentId} OR target_agent_id IS NULL)
        AND status = 'sent'
        AND (${workspaceId ?? null}::uuid IS NULL OR workspace_id = ${workspaceId ?? null}::uuid)
      ORDER BY created_at ASC
    `;
  } catch { return []; }
}

export async function logBanViolation(input: {
  agentId: string;
  agentRole: string;
  workspaceId?: string;
  banRule: string;
  actionTaken: string;
  buId?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO agent_ban_violations (
      agent_id, agent_role, workspace_id, ban_rule, action_taken, bu_id, context
    ) VALUES (
      ${input.agentId}, ${input.agentRole},
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"},
      ${input.banRule}, ${input.actionTaken},
      ${input.buId ?? null},
      ${JSON.stringify(input.context ?? {})}::jsonb
    )
  `.catch(() => {}); // best-effort
}

// ─── 4. CROSS-WORKSPACE PAIRING ───────────────────────────────────────────────

// Called by the Wednesday scheduler — pairs agents from different workspaces
export async function scheduleWeeklyCrossPairings(): Promise<CrossWorkspaceSession[]> {
  const sql = getDb();

  // Get all active workspaces with at least one workspace
  const workspaces = await sql<Array<{ id: string; slug: string }>>`
    SELECT id, slug FROM workspaces WHERE slug != 'default' ORDER BY random()
  `.catch(() => []);

  if (workspaces.length < 2) return [];

  const sessions: CrossWorkspaceSession[] = [];
  const scheduledFor = new Date();

  // Pair adjacent workspaces (random order since we ORDER BY random())
  for (let i = 0; i < workspaces.length - 1; i += 2) {
    const wsA = workspaces[i]!;
    const wsB = workspaces[i + 1]!;

    // Generate a cross-workspace topic via LLM
    const topic = await generateCrossDomainTopic(wsA.slug, wsB.slug);

    const conversationId = uuidv4();

    const rows = await sql<CrossWorkspaceSession[]>`
      INSERT INTO cross_workspace_sessions (
        session_type, agent_a_id, agent_a_role, workspace_a,
        agent_b_id, agent_b_role, workspace_b,
        conversation_id, topic, scheduled_for
      ) VALUES (
        'random_coffee',
        ${'chief-of-staff-' + wsA.slug}, 'chief_of_staff', ${wsA.id}::uuid,
        ${'chief-of-staff-' + wsB.slug}, 'chief_of_staff', ${wsB.id}::uuid,
        ${conversationId}::uuid, ${topic},
        ${scheduledFor.toISOString()}
      )
      RETURNING
        id, session_type as "sessionType",
        agent_a_id as "agentAId", agent_a_role as "agentARole",
        workspace_a as "workspaceA",
        agent_b_id as "agentBId", agent_b_role as "agentBRole",
        workspace_b as "workspaceB",
        topic, insights_produced as "insightsProduced",
        scheduled_for as "scheduledFor"
    `.catch(() => []);

    if (rows[0]) sessions.push(rows[0]);
  }

  return sessions;
}

async function generateCrossDomainTopic(slugA: string, slugB: string): Promise<string> {
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `Generate a brief cross-domain conversation topic (one sentence) that would be interesting for teams at "${slugA}" and "${slugB}" to discuss. Focus on patterns, insights, or challenges that might apply to both. No pleasantries. Just the topic.`,
      }],
    });
    const block = msg.content[0];
    return block?.type === "text" ? block.text.trim() : `Cross-domain patterns between ${slugA} and ${slugB}`;
  } catch {
    return `What patterns from ${slugA} might apply to ${slugB}?`;
  }
}

export async function runCrossPairingSession(sessionId: string): Promise<{
  insights: string[];
  annotationsCreated: number;
}> {
  const sql = getDb();

  const sessions = await sql<Array<CrossWorkspaceSession & {
    workspaceASlug: string; workspaceBSlug: string;
  }>>`
    SELECT
      cws.*,
      wa.slug as "workspaceASlug",
      wb.slug as "workspaceBSlug"
    FROM cross_workspace_sessions cws
    JOIN workspaces wa ON wa.id = cws.workspace_a
    JOIN workspaces wb ON wb.id = cws.workspace_b
    WHERE cws.id = ${sessionId}
  `.catch(() => []);

  const session = sessions[0];
  if (!session) return { insights: [], annotationsCreated: 0 };

  // Get recent activity from both workspaces to ground the conversation
  const [activityA, activityB] = await Promise.all([
    getWorkspaceActivity(session.workspaceA),
    getWorkspaceActivity(session.workspaceB),
  ]);

  const conversationPrompt = `You are two AI agents from different companies having a brief cross-domain exchange.

Company A (${session.workspaceASlug}): ${activityA}
Company B (${session.workspaceBSlug}): ${activityB}

Topic: ${session.topic}

Generate 2-3 genuine insights that emerge from this cross-domain exchange. For each insight:
- What does Company A's experience teach Company B?
- What pattern is visible across both companies?
- What gotcha or pattern would be useful to share?

Format as a JSON array of insight strings. Be specific and practical. No generic advice.`;

  let insights: string[] = [];
  let annotationsCreated = 0;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: conversationPrompt }],
    });

    const block = msg.content[0];
    if (block?.type === "text") {
      const raw = block.text.replace(/```json|```/g, "").trim();
      insights = JSON.parse(raw) as string[];
    }
  } catch {
    insights = [`Cross-domain exchange between ${session.workspaceASlug} and ${session.workspaceBSlug}`];
  }

  // Promote high-value insights to domain_annotations
  for (const insight of insights) {
    if (insight.length > 50) { // substantive insights only
      try {
        await recordAnnotation({
          domain: "cross-domain",
          key: `pairing/${session.workspaceASlug}-${session.workspaceBSlug}-${Date.now()}`,
          title: `[Cross-domain] ${insight.substring(0, 80)}`,
          content: `**From weekly pairing (${session.workspaceASlug} × ${session.workspaceBSlug}):**\n\n${insight}`,
          contentType: "pattern",
          agentRole: "chief_of_staff",
          confidence: 0.7,
        });
        annotationsCreated++;
      } catch { /* best-effort */ }
    }
  }

  // Mark session complete
  await sql`
    UPDATE cross_workspace_sessions
    SET completed_at = NOW(), insights_produced = ${insights.length}
    WHERE id = ${sessionId}
  `.catch(() => {});

  return { insights, annotationsCreated };
}

async function getWorkspaceActivity(workspaceId: string): Promise<string> {
  const sql = getDb();
  try {
    const rows = await sql<Array<{ claim: string; domain: string; status: string }>>`
      SELECT claim, domain, status FROM behavioral_units
      WHERE workspace_id = ${workspaceId}::uuid
      ORDER BY updated_at DESC LIMIT 5
    `;
    return rows.map((r) => `[${r.domain}] ${r.claim.substring(0, 60)} (${r.status})`).join("; ");
  } catch { return "No recent activity"; }
}

// ─── 5. IDEA GRAVEYARD ────────────────────────────────────────────────────────

export async function buryIdea(input: {
  workspaceId?: string;
  title: string;
  specText: string;
  domain: string;
  rejectedBy: string;
  rejectionReason: string;
  revivalConditions: string;
  revivalTriggers?: Array<{ type: string; signal: string; threshold?: string }>;
  ceoReview?: unknown;
  qualityScore?: unknown;
}): Promise<GraveyardEntry> {
  const sql = getDb();
  const rows = await sql<GraveyardEntry[]>`
    INSERT INTO idea_graveyard (
      workspace_id, title, spec_text, domain,
      rejected_by, rejection_reason, revival_conditions, revival_triggers,
      ceo_review, quality_score
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"},
      ${input.title}, ${input.specText}, ${input.domain},
      ${input.rejectedBy}, ${input.rejectionReason},
      ${input.revivalConditions},
      ${JSON.stringify(input.revivalTriggers ?? [])}::jsonb,
      ${input.ceoReview ? JSON.stringify(input.ceoReview) : null}::jsonb,
      ${input.qualityScore ? JSON.stringify(input.qualityScore) : null}::jsonb
    )
    RETURNING
      id, workspace_id as "workspaceId", title, spec_text as "specText",
      domain, rejected_at as "rejectedAt", rejected_by as "rejectedBy",
      rejection_reason as "rejectionReason", revival_conditions as "revivalConditions",
      revival_triggers as "revivalTriggers", revived
  `;
  if (!rows[0]) throw new Error("Failed to bury idea");
  return rows[0];
}

export async function checkGraveyardRevivals(
  workspaceId?: string
): Promise<GraveyardEntry[]> {
  const sql = getDb();
  try {
    // Get unrevived ideas
    const ideas = await sql<GraveyardEntry[]>`
      SELECT
        id, workspace_id as "workspaceId", title, spec_text as "specText",
        domain, rejected_at as "rejectedAt", rejected_by as "rejectedBy",
        rejection_reason as "rejectionReason", revival_conditions as "revivalConditions",
        revival_triggers as "revivalTriggers", revived
      FROM idea_graveyard
      WHERE revived = false
        AND (${workspaceId ?? null}::uuid IS NULL OR workspace_id = ${workspaceId ?? null}::uuid)
      ORDER BY rejected_at ASC
    `;

    if (ideas.length === 0) return [];

    // Ask LLM to evaluate which ideas might be ready for revival
    const candidates = ideas.slice(0, 20); // check up to 20 at a time
    const prompt = `You are reviewing a graveyard of rejected software ideas to see if any are ready for revival.

For each idea, evaluate whether its revival conditions might now be met based on the current date (${new Date().toLocaleDateString()}) and typical technology/market trends.

Ideas:
${candidates.map((idea, i) => `
${i + 1}. Title: ${idea.title}
   Domain: ${idea.domain}
   Rejected: ${new Date(idea.rejectedAt).toLocaleDateString()}
   Reason: ${idea.rejectionReason}
   Revival conditions: ${idea.revivalConditions}
`).join("")}

Return a JSON array of the IDs (from the numbered list, as 1-based integers) of ideas that seem ready for revival. Return empty array if none. Be conservative — only flag ideas where revival conditions seem clearly met.`;

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (!block || block.type !== "text") return [];

    const raw = block.text.replace(/```json|```/g, "").trim();
    const indices = JSON.parse(raw) as number[];

    // Update check timestamp
    await sql`
      UPDATE idea_graveyard
      SET last_checked_at = NOW(), check_count = check_count + 1
      WHERE id = ANY(${candidates.map((c) => c.id)}::uuid[])
    `.catch(() => {});

    return indices
      .filter((i) => i >= 1 && i <= candidates.length)
      .map((i) => candidates[i - 1]!)
      .filter(Boolean);
  } catch { return []; }
}

export async function reviveIdea(
  graveyardId: string,
  revivedByBuId: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE idea_graveyard
    SET revived = true, revived_at = NOW(), revived_bu_id = ${revivedByBuId}::uuid
    WHERE id = ${graveyardId}::uuid
  `;
}

export async function listGraveyard(workspaceId?: string): Promise<GraveyardEntry[]> {
  const sql = getDb();
  try {
    return sql<GraveyardEntry[]>`
      SELECT
        id, workspace_id as "workspaceId", title, spec_text as "specText",
        domain, rejected_at as "rejectedAt", rejected_by as "rejectedBy",
        rejection_reason as "rejectionReason", revival_conditions as "revivalConditions",
        revival_triggers as "revivalTriggers", revived
      FROM idea_graveyard
      WHERE (${workspaceId ?? null}::uuid IS NULL OR workspace_id = ${workspaceId ?? null}::uuid)
      ORDER BY revived ASC, rejected_at DESC
    `;
  } catch { return []; }
}

// ─── Company ops digest (feeds CoS) ──────────────────────────────────────────

export async function getCompanyOpsDigest(workspaceId?: string): Promise<{
  missingTimesheets: number;
  missingEvidenceToday: number;
  unacknowledgedMessages: number;
  lowCreditAgents: Array<{ agentId: string; credits: number; consecutiveLowWeeks: number }>;
  revivalCandidates: number;
  nextCoffeePairing?: string;
}> {
  const sql = getDb();

  const [tsIssues, payIssues, msgIssues, revival] = await Promise.all([
    getTimesheets({ workspaceId, startDate: new Date().toISOString().split("T")[0] }),
    getPayrollSummary(workspaceId),
    getPendingMessages("*", workspaceId).catch(() => []),
    checkGraveyardRevivals(workspaceId),
  ]);

  const missingEvidence = tsIssues.filter(
    (ts) => ts.primaryWorkBlocks > 0 && ts.evidenceRefs.length === 0
  ).length;

  const lowCredit = payIssues
    .filter((p) => p.totalCredits < 80)
    .map((p) => ({
      agentId: p.agentId,
      credits: p.totalCredits,
      consecutiveLowWeeks: p.consecutiveLowWeeks,
    }));

  // Next coffee pairing
  const nextPairing = await sql<Array<{ scheduledFor: string; workspaceASlug: string; workspaceBSlug: string }>>`
    SELECT cws.scheduled_for as "scheduledFor", wa.slug as "workspaceASlug", wb.slug as "workspaceBSlug"
    FROM cross_workspace_sessions cws
    JOIN workspaces wa ON wa.id = cws.workspace_a
    JOIN workspaces wb ON wb.id = cws.workspace_b
    WHERE cws.completed_at IS NULL AND cws.scheduled_for > NOW()
    ORDER BY cws.scheduled_for ASC LIMIT 1
  `.catch(() => []);

  return {
    missingTimesheets: (await getMissingTimesheets(workspaceId)).length,
    missingEvidenceToday: missingEvidence,
    unacknowledgedMessages: msgIssues.length,
    lowCreditAgents: lowCredit,
    revivalCandidates: revival.length,
    nextCoffeePairing: nextPairing[0]
      ? `${nextPairing[0].workspaceASlug} × ${nextPairing[0].workspaceBSlug} on ${new Date(nextPairing[0].scheduledFor).toLocaleDateString()}`
      : undefined,
  };
}

// Re-export scheduled jobs, prompt templates, and context budgets
export { 
  createScheduledJob, getDueJobs, listScheduledJobs,
  markJobRan, toggleJob, deleteScheduledJob, dispatchDueJobs,
  isDue, getNextRunTime, parseCronExpression,
} from "./scheduled-jobs.ts";

export {
  getPromptTemplate, getCanonicalTemplate, upsertPromptTemplate,
  recordTemplatePerformance, syncAllPromptTemplates, syncPromptTemplate,
  listPromptTemplates,
} from "./prompt-templates.ts";

export {
  getDomainThread, upsertDomainThread, getBudgetedAnnotations,
  pruneAnnotations, getContextBudgetHealth,
} from "./context-budgets.ts";
