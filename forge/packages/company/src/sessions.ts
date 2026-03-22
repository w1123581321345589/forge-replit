/**
 * Agent session persistence.
 *
 * The OpenClaw insight: a 2-hour default idle timeout makes agents feel
 * forgetful. The default IS the product. Forge makes all defaults explicit
 * and configurable through forge schedule --list.
 *
 * Key design decisions:
 * - Default idle threshold: 4 days (5760 min), not 2 hours
 * - Sessions survive idle — they expire only past the threshold
 * - In-session context (informal knowledge) is separate from domain annotations
 * - At expiry, a handoff note is generated for the next session
 * - Expiring sessions surface in the CoS inbox with one ask: extend or close?
 */

import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@forge/db";
import { recordAnnotation } from "@forge/intent-graph";

const client = new Anthropic();

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus = "active" | "idle" | "expired" | "extended" | "closed" | "graveyarded";
export type ContextItemType = "attempted" | "human_said" | "discovered" | "blocked_on" | "next_step" | "learned";

export interface AgentSession {
  id: string;
  workspaceId: string;
  domain: string;
  agentRole: string;
  agentId: string;
  status: SessionStatus;
  idleThresholdMinutes: number;
  lastActiveAt: string;
  expiresAt: string;
  currentBuId?: string;
  sessionSummary?: string;
  partialContext: Record<string, unknown>;
  tasksCompleted: number;
  tasksAttempted: number;
  annotationsCreated: number;
  escalationsSurfaced: number;
  createdAt: string;
}

export interface SessionContextItem {
  id: string;
  sessionId: string;
  itemType: ContextItemType;
  content: string;
  buId?: string;
  promoted: boolean;
  confidence: number;
  createdAt: string;
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

export async function startOrResumeSession(input: {
  domain: string;
  agentRole: string;
  agentId: string;
  workspaceId?: string;
  buId?: string;
  idleThresholdMinutes?: number;
}): Promise<{ session: AgentSession; isResumed: boolean; handoffNote?: string }> {
  const sql = getDb();
  const wsId = input.workspaceId ?? "00000000-0000-0000-0000-000000000001";

  // Check for an existing active/idle session for this (domain, role, workspace)
  const existing = await sql<AgentSession[]>`
    SELECT
      id, workspace_id as "workspaceId", domain, agent_role as "agentRole",
      agent_id as "agentId", status,
      idle_threshold_minutes as "idleThresholdMinutes",
      last_active_at as "lastActiveAt", expires_at as "expiresAt",
      current_bu_id as "currentBuId", session_summary as "sessionSummary",
      partial_context as "partialContext",
      tasks_completed as "tasksCompleted", tasks_attempted as "tasksAttempted",
      annotations_created as "annotationsCreated",
      escalations_surfaced as "escalationsSurfaced",
      created_at as "createdAt"
    FROM agent_sessions
    WHERE workspace_id = ${wsId}::uuid
      AND domain = ${input.domain}
      AND agent_role = ${input.agentRole}
      AND status IN ('active', 'idle', 'extended')
    ORDER BY last_active_at DESC
    LIMIT 1
  `.catch(() => []);

  if (existing[0]) {
    // Resume — update last_active_at and mark active
    const resumed = await sql<AgentSession[]>`
      UPDATE agent_sessions SET
        status = 'active',
        agent_id = ${input.agentId},
        current_bu_id = ${input.buId ?? null}::uuid,
        last_active_at = NOW(),
        updated_at = NOW()
      WHERE id = ${existing[0].id}
      RETURNING
        id, workspace_id as "workspaceId", domain, agent_role as "agentRole",
        agent_id as "agentId", status,
        idle_threshold_minutes as "idleThresholdMinutes",
        last_active_at as "lastActiveAt", expires_at as "expiresAt",
        current_bu_id as "currentBuId", session_summary as "sessionSummary",
        partial_context as "partialContext",
        tasks_completed as "tasksCompleted", tasks_attempted as "tasksAttempted",
        annotations_created as "annotationsCreated",
        escalations_surfaced as "escalationsSurfaced",
        created_at as "createdAt"
    `;

    // Get the most recent handoff note if resuming after a gap
    const handoff = await sql<Array<{ handoffNote: string }>>`
      SELECT handoff_note as "handoffNote"
      FROM session_handoffs
      WHERE workspace_id = ${wsId}::uuid
        AND domain = ${input.domain}
        AND agent_role = ${input.agentRole}
        AND to_session_id = ${existing[0].id}
      ORDER BY created_at DESC LIMIT 1
    `.catch(() => []);

    return {
      session: resumed[0] ?? existing[0],
      isResumed: true,
      handoffNote: handoff[0]?.handoffNote,
    };
  }

  // New session
  const threshold = input.idleThresholdMinutes ?? 5760; // 4 days default
  const rows = await sql<AgentSession[]>`
    INSERT INTO agent_sessions (
      workspace_id, domain, agent_role, agent_id, status,
      idle_threshold_minutes, current_bu_id, last_active_at
    ) VALUES (
      ${wsId}::uuid, ${input.domain}, ${input.agentRole}, ${input.agentId},
      'active', ${threshold}, ${input.buId ?? null}::uuid, NOW()
    )
    RETURNING
      id, workspace_id as "workspaceId", domain, agent_role as "agentRole",
      agent_id as "agentId", status,
      idle_threshold_minutes as "idleThresholdMinutes",
      last_active_at as "lastActiveAt", expires_at as "expiresAt",
      current_bu_id as "currentBuId", session_summary as "sessionSummary",
      partial_context as "partialContext",
      tasks_completed as "tasksCompleted", tasks_attempted as "tasksAttempted",
      annotations_created as "annotationsCreated",
      escalations_surfaced as "escalationsSurfaced",
      created_at as "createdAt"
  `;
  if (!rows[0]) throw new Error("Failed to create agent session");
  return { session: rows[0], isResumed: false };
}

export async function touchSession(sessionId: string, status: "active" | "idle" = "active"): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE agent_sessions SET
      status = ${status}, last_active_at = NOW(), updated_at = NOW()
    WHERE id = ${sessionId}
  `.catch(() => {});
}

export async function incrementSessionMetrics(sessionId: string, updates: {
  tasksCompleted?: number;
  tasksAttempted?: number;
  annotationsCreated?: number;
  escalationsSurfaced?: number;
  sessionSummary?: string;
  currentBuId?: string;
}): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE agent_sessions SET
      tasks_completed = tasks_completed + ${updates.tasksCompleted ?? 0},
      tasks_attempted = tasks_attempted + ${updates.tasksAttempted ?? 0},
      annotations_created = annotations_created + ${updates.annotationsCreated ?? 0},
      escalations_surfaced = escalations_surfaced + ${updates.escalationsSurfaced ?? 0},
      session_summary = COALESCE(${updates.sessionSummary ?? null}, session_summary),
      current_bu_id = COALESCE(${updates.currentBuId ?? null}::uuid, current_bu_id),
      last_active_at = NOW(),
      updated_at = NOW()
    WHERE id = ${sessionId}
  `.catch(() => {});
}

// ─── Session context items ────────────────────────────────────────────────────

export async function addContextItem(input: {
  sessionId: string;
  itemType: ContextItemType;
  content: string;
  buId?: string;
  confidence?: number;
  workspaceId?: string;
}): Promise<SessionContextItem> {
  const sql = getDb();
  const rows = await sql<SessionContextItem[]>`
    INSERT INTO session_context_items (
      session_id, workspace_id, item_type, content, bu_id, confidence
    ) VALUES (
      ${input.sessionId}::uuid,
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.itemType}, ${input.content},
      ${input.buId ?? null}::uuid, ${input.confidence ?? 0.6}
    )
    RETURNING id, session_id as "sessionId", item_type as "itemType",
      content, bu_id as "buId", promoted, confidence,
      created_at as "createdAt"
  `;
  if (!rows[0]) throw new Error("Failed to add context item");
  return rows[0];
}

export async function getSessionContext(sessionId: string): Promise<SessionContextItem[]> {
  const sql = getDb();
  try {
    return sql<SessionContextItem[]>`
      SELECT id, session_id as "sessionId", item_type as "itemType",
        content, bu_id as "buId", promoted, confidence, created_at as "createdAt"
      FROM session_context_items
      WHERE session_id = ${sessionId}::uuid
      ORDER BY created_at ASC
    `;
  } catch { return []; }
}

export function formatSessionContextForPrompt(
  items: SessionContextItem[],
  handoffNote?: string
): string {
  if (items.length === 0 && !handoffNote) return "";

  const lines: string[] = ["## Session context (what this agent knows from prior work)", ""];

  if (handoffNote) {
    lines.push("### Handoff from previous session");
    lines.push(handoffNote);
    lines.push("");
  }

  const byType: Record<string, SessionContextItem[]> = {};
  for (const item of items) {
    (byType[item.itemType] ??= []).push(item);
  }

  const typeLabels: Record<ContextItemType, string> = {
    attempted:  "Already tried (and why it failed)",
    human_said: "Operator said",
    discovered: "Discovered in this session",
    blocked_on: "Currently blocked on",
    next_step:  "Next steps",
    learned:    "Learned (not yet a formal annotation)",
  };

  for (const [type, typeItems] of Object.entries(byType)) {
    if (typeItems.length === 0) continue;
    lines.push(`### ${typeLabels[type as ContextItemType] ?? type}`);
    typeItems.forEach((item) => lines.push(`- ${item.content}`));
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Session expiry ───────────────────────────────────────────────────────────

export async function checkExpiringSessions(
  warnHoursBefore = 2,
  workspaceId?: string
): Promise<Array<{
  sessionId: string; workspace: string; domain: string; agentRole: string;
  hoursUntilExpiry: number; tasksCompleted: number; contextItems: number;
}>> {
  const sql = getDb();
  try {
    return sql<Array<{
      sessionId: string; workspace: string; domain: string; agentRole: string;
      hoursUntilExpiry: number; tasksCompleted: number; contextItems: number;
    }>>`
      SELECT
        id as "sessionId", workspace, domain, "agentRole",
        "hoursUntilExpiry", "tasksCompleted", "contextItems"
      FROM v_expiring_sessions
      WHERE "hoursUntilExpiry" <= ${warnHoursBefore}
        AND (${workspaceId ?? null}::uuid IS NULL
             OR workspace_id = ${workspaceId ?? null}::uuid)
    `;
  } catch { return []; }
}

export async function runSessionExpiryCheck(workspaceId?: string): Promise<{
  expired: number; warned: number; graveyarded: number;
}> {
  const sql = getDb();
  let expired = 0;
  let warned = 0;
  let graveyarded = 0;

  try {
    // 1. Hard-expire sessions past their threshold
    const nowExpired = await sql<Array<{ id: string; domain: string; agentRole: string; tasksCompleted: number }>>`
      SELECT id, domain, agent_role as "agentRole", tasks_completed as "tasksCompleted"
      FROM agent_sessions
      WHERE status IN ('active', 'idle')
        AND expires_at < NOW()
        AND (${workspaceId ?? null}::uuid IS NULL OR workspace_id = ${workspaceId ?? null}::uuid)
    `.catch(() => []);

    for (const session of nowExpired) {
      // Generate handoff note before closing
      await generateHandoffNote(session.id).catch(() => {});

      // Promote high-confidence context items to annotations
      const promoted = await promoteContextItems(session.id, workspaceId);

      // Graveyard partial work if tasks were in-progress
      if (session.tasksCompleted === 0) {
        const contextItems = await getSessionContext(session.id);
        if (contextItems.length > 0) {
          await sql`
            UPDATE agent_sessions SET status = 'graveyarded', updated_at = NOW()
            WHERE id = ${session.id}
          `;
          graveyarded++;
        } else {
          await sql`
            UPDATE agent_sessions SET status = 'expired', updated_at = NOW()
            WHERE id = ${session.id}
          `;
        }
      } else {
        await sql`
          UPDATE agent_sessions SET status = 'expired', updated_at = NOW()
          WHERE id = ${session.id}
        `;
      }

      await sql`
        INSERT INTO session_expiry_log (
          session_id, workspace_id, domain, action,
          tasks_completed, context_items, annotations_promoted
        ) VALUES (
          ${session.id}::uuid,
          ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
          ${session.domain}, 'expired_auto',
          ${session.tasksCompleted}, 0, ${promoted}
        )
      `.catch(() => {});

      expired++;
    }

    // 2. Warn about sessions expiring within the next 2 hours
    const expiring = await checkExpiringSessions(2, workspaceId);
    warned = expiring.length;

  } catch { /* migration 011 not applied */ }

  return { expired, warned, graveyarded };
}

export async function extendSession(sessionId: string, additionalDays = 4): Promise<void> {
  const sql = getDb();
  const additionalMinutes = additionalDays * 24 * 60;
  await sql`
    UPDATE agent_sessions SET
      status = 'extended',
      idle_threshold_minutes = idle_threshold_minutes + ${additionalMinutes},
      last_active_at = NOW(),
      updated_at = NOW()
    WHERE id = ${sessionId}
  `;
  await sql`
    INSERT INTO session_expiry_log (session_id, workspace_id, domain, action)
    SELECT id, workspace_id, domain, 'extended_human'
    FROM agent_sessions WHERE id = ${sessionId}
  `.catch(() => {});
}

export async function closeSession(sessionId: string, closedBy = "human"): Promise<void> {
  const sql = getDb();
  await generateHandoffNote(sessionId).catch(() => {});
  await promoteContextItems(sessionId).catch(() => {});
  await sql`
    UPDATE agent_sessions SET status = 'closed', updated_at = NOW()
    WHERE id = ${sessionId}
  `;
  await sql`
    INSERT INTO session_expiry_log (session_id, workspace_id, domain, action, acted_by)
    SELECT id, workspace_id, domain, 'closed_human', ${closedBy}
    FROM agent_sessions WHERE id = ${sessionId}
  `.catch(() => {});
}

// ─── Handoff generation ───────────────────────────────────────────────────────
// Generate a concise briefing note at session close so the next session
// doesn't start from scratch. Like the note you leave a colleague.

async function generateHandoffNote(sessionId: string): Promise<string> {
  const sql = getDb();

  const sessions = await sql<Array<AgentSession & {
    workspaceSlug: string;
  }>>`
    SELECT s.*, ws.slug as "workspaceSlug"
    FROM agent_sessions s
    JOIN workspaces ws ON ws.id = s.workspace_id
    WHERE s.id = ${sessionId}
  `.catch(() => []);

  const session = sessions[0];
  if (!session) return "";

  const contextItems = await getSessionContext(sessionId);
  if (contextItems.length === 0) return "";

  const contextSummary = contextItems
    .map((i) => `[${i.itemType}] ${i.content}`)
    .join("\n");

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Write a concise handoff note (3-5 sentences) for the next agent session that will continue this work.

Domain: ${session.domain}
Agent role: ${session.agentRole}
Session summary: ${session.sessionSummary ?? "No summary"}
Tasks completed: ${session.tasksCompleted}
Tasks attempted: ${session.tasksAttempted}

Context from this session:
${contextSummary}

Write the handoff note as if briefing a colleague who is picking up this work. Be specific. Focus on: where we left off, what was tried, what the next step is, and any critical gotchas discovered. No pleasantries.`,
      }],
    });

    const block = msg.content[0];
    const note = block?.type === "text" ? block.text.trim() : contextSummary;

    // Store the handoff
    await sql`
      INSERT INTO session_handoffs (
        from_session_id, workspace_id, domain, agent_role,
        handoff_note, context_items_forwarded
      ) VALUES (
        ${sessionId}::uuid,
        ${session.workspaceId}::uuid,
        ${session.domain}, ${session.agentRole},
        ${note}, ${contextItems.length}
      )
    `.catch(() => {});

    return note;
  } catch {
    return contextSummary;
  }
}

// ─── Context item promotion ───────────────────────────────────────────────────
// High-confidence in-session learnings become formal domain annotations.

async function promoteContextItems(sessionId: string, workspaceId?: string): Promise<number> {
  const sql = getDb();
  let promoted = 0;

  const promotable = await sql<Array<SessionContextItem & { sessionDomain: string }>>`
    SELECT sci.*, s.domain as "sessionDomain"
    FROM session_context_items sci
    JOIN agent_sessions s ON s.id = sci.session_id
    WHERE sci.session_id = ${sessionId}::uuid
      AND sci.promoted = false
      AND sci.confidence >= 0.75
      AND sci.item_type IN ('discovered', 'learned')
  `.catch(() => []);

  for (const item of promotable) {
    try {
      const annotation = await recordAnnotation({
        domain: item.sessionDomain,
        key: `session/${sessionId.substring(0, 8)}/${item.itemType}-${Date.now()}`,
        title: `[Session] ${item.content.substring(0, 80)}`,
        content: item.content,
        contentType: item.itemType === "discovered" ? "gotcha" : "pattern",
        agentRole: "implementer",
        buId: item.buId,
        confidence: item.confidence * 0.9, // slight decay when promoting from session
      });

      await sql`
        UPDATE session_context_items SET
          promoted = true, annotation_id = ${annotation.id}::uuid
        WHERE id = ${item.id}
      `;
      promoted++;
    } catch { /* best-effort */ }
  }

  return promoted;
}

// ─── Active session query ─────────────────────────────────────────────────────

export async function getActiveSessions(workspaceId?: string): Promise<Array<{
  sessionId: string; workspace: string; domain: string; agentRole: string;
  status: string; hoursUntilExpiry: number; minutesIdle: number;
  tasksCompleted: number; contextItems: number; promotableItems: number;
}>> {
  const sql = getDb();
  try {
    return sql<Array<{
      sessionId: string; workspace: string; domain: string; agentRole: string;
      status: string; hoursUntilExpiry: number; minutesIdle: number;
      tasksCompleted: number; contextItems: number; promotableItems: number;
    }>>`
      SELECT
        id as "sessionId", workspace, domain, "agentRole", status,
        "hoursUntilExpiry", "minutesIdle",
        "tasksCompleted", "contextItems", "promotableItems"
      FROM v_active_sessions
      WHERE (${workspaceId ?? null}::uuid IS NULL
             OR workspace_id = ${workspaceId ?? null}::uuid)
    `;
  } catch { return []; }
}

export async function getSessionById(sessionId: string): Promise<AgentSession | null> {
  const sql = getDb();
  try {
    const rows = await sql<AgentSession[]>`
      SELECT
        id, workspace_id as "workspaceId", domain, agent_role as "agentRole",
        agent_id as "agentId", status,
        idle_threshold_minutes as "idleThresholdMinutes",
        last_active_at as "lastActiveAt", expires_at as "expiresAt",
        current_bu_id as "currentBuId", session_summary as "sessionSummary",
        partial_context as "partialContext",
        tasks_completed as "tasksCompleted", tasks_attempted as "tasksAttempted",
        annotations_created as "annotationsCreated",
        escalations_surfaced as "escalationsSurfaced",
        created_at as "createdAt"
      FROM agent_sessions WHERE id = ${sessionId}
    `;
    return rows[0] ?? null;
  } catch { return null; }
}
