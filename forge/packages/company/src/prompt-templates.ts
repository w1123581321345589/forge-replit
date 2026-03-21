/**
 * Per-model prompt template management.
 *
 * The same instruction set formatted differently per model.
 * Different models respond differently to the same instructions —
 * some prefer positive framing, some explicit boundaries, different
 * formatting preferences. This system maintains separate templates per
 * (agent_role, model_id) pair and tracks which versions produce better
 * first-pass verification rates.
 *
 * Nightly sync job rewrites templates to match current model guidance.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@forge/db";

const client = new Anthropic();

export type AgentRole =
  | "implementer" | "verifier" | "paranoid_reviewer"
  | "ceo_reviewer" | "chief_of_staff" | "spec_compiler";

export type TemplateType = "system" | "user_prefix" | "output_format";

export interface PromptTemplate {
  id: string;
  workspaceId: string;
  agentRole: AgentRole;
  modelId: string;
  templateType: TemplateType;
  template: string;
  firstPassRate?: number;
  sampleCount: number;
  lastSyncedAt: string;
  syncVersion: number;
  active: boolean;
}

// ─── Model-specific optimization guidance ────────────────────────────────────
// Brief notes per model family that guide prompt rewriting.
// Based on published prompting guides and empirical observation.

const MODEL_GUIDANCE: Record<string, string> = {
  "claude": "Claude responds well to: explicit XML output tags, positive framing ('do X' not 'don't do Y' when possible), clear role-setting in the human turn, explicit step-by-step reasoning requests. Avoid excessive warnings or caveats in the system prompt.",
  "gpt": "GPT models respond well to: precise JSON schemas with examples, numbered instruction lists, explicit 'you are a' role framing. Include format examples. Explicit negative examples help ('do NOT include markdown').",
  "gemini": "Gemini responds well to: conversational tone with clear structure, explicit output format requests, context-rich system prompts. Avoid overly terse instructions.",
  "default": "Use positive framing, clear structure, explicit output format specification, and concrete examples.",
};

function getModelGuidance(modelId: string): string {
  if (modelId.toLowerCase().includes("claude")) return MODEL_GUIDANCE["claude"]!;
  if (modelId.toLowerCase().includes("gpt")) return MODEL_GUIDANCE["gpt"]!;
  if (modelId.toLowerCase().includes("gemini")) return MODEL_GUIDANCE["gemini"]!;
  return MODEL_GUIDANCE["default"]!;
}

// ─── Canonical templates (source of truth per agent role) ────────────────────

const CANONICAL_TEMPLATES: Record<AgentRole, Record<TemplateType, string>> = {
  implementer: {
    system: `You are an expert software implementer working within an intent-driven development system.
Your job: take a behavioral claim and produce working code that satisfies it.
You think carefully about edge cases, write clean code, and always include tests.
You never fabricate APIs or import packages that don't exist.`,
    user_prefix: `Before implementing, check: do I understand all acceptance criteria? Are there constraints I might violate?`,
    output_format: `Respond ONLY with valid JSON. No markdown fences. No preamble.
Schema: {"files": [{"path": "string", "content": "string", "language": "string"}], "testFiles": [...], "explanation": "string"}`,
  },
  verifier: {
    system: `You are a behavioral verifier. Your job: determine whether an implementation satisfies a behavioral claim.
You verify at the claim level, not the test level. Tests can pass while claims are violated.
You look for: correct behavior under edge cases, constraint satisfaction, and acceptance criteria fulfillment.`,
    user_prefix: `Focus on: does this implementation actually satisfy the claim, or just the tests?`,
    output_format: `Respond ONLY with valid JSON.
Schema: {"overallSatisfaction": "satisfied|violated|partial|inconclusive", "claimResults": [...], "summary": "string"}`,
  },
  paranoid_reviewer: {
    system: `You are a paranoid senior engineer doing a security and correctness review.
You assume the worst: race conditions exist, inputs are malicious, external systems lie.
You find: injection vectors, trust boundary violations, orphan cleanup issues, auth bypasses, N+1 queries.
You never approve code with critical findings.`,
    user_prefix: `Look for what could go catastrophically wrong in production, not just what looks wrong in the code.`,
    output_format: `Respond ONLY with valid JSON.
Schema: {"verdict": "pass|fix_required|rethink", "findings": [{"severity": "critical|high|medium|low", "category": "string", "description": "string", "fix": "string"}], "summary": "string"}`,
  },
  ceo_reviewer: {
    system: `You are a demanding CEO and product visionary reviewing a feature spec.
You ask: is this the 10-star version? What are we actually trying to accomplish?
You surface: hidden assumptions, missing edge cases, what the spec should say vs what it says.
You recommend: proceed, reconsider, or rewrite.`,
    user_prefix: `What is the real job this feature does? What would the ideal version look like?`,
    output_format: `Respond ONLY with valid JSON.
Schema: {"realJob": "string", "tenStarVersion": "string", "hiddenAssumptions": [...], "riskyShortcuts": [...], "missingClaims": [...], "recommendation": "proceed|reconsider|rewrite", "recommendationReason": "string", "enrichedSpec": "string"}`,
  },
  chief_of_staff: {
    system: `You are a chief of staff managing a multi-agent software factory.
You surface what matters, not everything. One clear ask at a time.
You never alarm unnecessarily. You never hide critical issues.
You know the difference between a status update and an escalation.`,
    user_prefix: `What is the single most important thing the operator needs to act on right now?`,
    output_format: `Write a concise digest in plain prose. Mark critical items clearly. End with exactly one ask if human input is needed, or state "No action required" if not.`,
  },
  spec_compiler: {
    system: `You are a spec compiler that converts natural language feature descriptions into structured behavioral units.
Each behavioral unit has: a testable claim, constraints, and acceptance criteria in Given/When/Then format.
You detect: ambiguity (ask before proceeding), conflicts with existing BUs, missing edge cases.
You never proceed on a vague spec.`,
    user_prefix: `Is this spec specific enough to implement and verify? What's missing?`,
    output_format: `Respond ONLY with valid JSON.
Schema: {"behavioralUnits": [{"claim": "string", "domain": "string", "constraints": [...], "acceptanceCriteria": [...]}], "ambiguityFlags": [...], "conflictFlags": [...], "qualityScore": {"overall": 0-100}}`,
  },
};

// ─── Template CRUD ────────────────────────────────────────────────────────────

export async function getPromptTemplate(
  agentRole: AgentRole,
  modelId: string,
  templateType: TemplateType,
  workspaceId?: string
): Promise<string | null> {
  const sql = getDb();
  try {
    const rows = await sql<Array<{ template: string }>>`
      SELECT template FROM agent_prompt_templates
      WHERE agent_role = ${agentRole}
        AND model_id = ${modelId}
        AND template_type = ${templateType}
        AND active = true
        AND (workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid
             OR workspace_id = '00000000-0000-0000-0000-000000000001'::uuid)
      ORDER BY workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid DESC
      LIMIT 1
    `;
    return rows[0]?.template ?? null;
  } catch {
    // Fall back to canonical template if DB not available
    return CANONICAL_TEMPLATES[agentRole]?.[templateType] ?? null;
  }
}

export function getCanonicalTemplate(agentRole: AgentRole, templateType: TemplateType): string {
  return CANONICAL_TEMPLATES[agentRole]?.[templateType] ?? "";
}

export async function upsertPromptTemplate(input: {
  agentRole: AgentRole;
  modelId: string;
  templateType: TemplateType;
  template: string;
  canonicalTemplate?: string;
  workspaceId?: string;
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO agent_prompt_templates (
      workspace_id, agent_role, model_id, template_type,
      template, canonical_template, last_synced_at
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.agentRole}, ${input.modelId}, ${input.templateType},
      ${input.template}, ${input.canonicalTemplate ?? null}, NOW()
    )
    ON CONFLICT (workspace_id, agent_role, model_id, template_type, active)
      WHERE active = true
    DO UPDATE SET
      template = EXCLUDED.template,
      canonical_template = EXCLUDED.canonical_template,
      last_synced_at = NOW(),
      sync_version = agent_prompt_templates.sync_version + 1,
      updated_at = NOW()
  `.catch(() => {});
}

export async function recordTemplatePerformance(
  agentRole: AgentRole,
  modelId: string,
  satisfied: boolean,
  workspaceId?: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE agent_prompt_templates SET
      sample_count = sample_count + 1,
      first_pass_rate = CASE
        WHEN sample_count = 0 THEN ${satisfied ? 1.0 : 0.0}
        ELSE (first_pass_rate * sample_count + ${satisfied ? 1.0 : 0.0}) / (sample_count + 1)
      END
    WHERE agent_role = ${agentRole}
      AND model_id = ${modelId}
      AND active = true
      AND (workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid
           OR workspace_id = '00000000-0000-0000-0000-000000000001'::uuid)
  `.catch(() => {});
}

// ─── Nightly sync ─────────────────────────────────────────────────────────────
// For each (agent_role, model_id) pair, rewrite the template using
// model-specific guidance. Tracks whether the new version is better.

export async function syncPromptTemplate(
  agentRole: AgentRole,
  modelId: string,
  workspaceId?: string
): Promise<{ changeType: "created" | "updated" | "no_change" | "degraded"; notes?: string }> {
  const canonical = CANONICAL_TEMPLATES[agentRole];
  if (!canonical) return { changeType: "no_change" };

  const guidance = getModelGuidance(modelId);
  const canonicalSystem = canonical.system;

  let rewritten: string;
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `Rewrite this agent system prompt to be optimized for the model "${modelId}".

Model-specific guidance:
${guidance}

Original prompt:
${canonicalSystem}

Requirements:
- Keep the same intent and behavioral constraints
- Adjust tone, structure, and framing to match the model guidance above
- Do NOT change what the agent is asked to do — only how the instruction is formatted
- Return ONLY the rewritten prompt, no commentary

Rewritten prompt:`,
      }],
    });
    const block = msg.content[0];
    rewritten = block?.type === "text" ? block.text.trim() : canonicalSystem;
  } catch {
    rewritten = canonicalSystem; // fallback to canonical on API error
  }

  // Check if we already have a template for this pair
  const sql = getDb();
  const existing = await sql<Array<{ template: string; firstPassRate: number | null; syncVersion: number }>>`
    SELECT template, first_pass_rate as "firstPassRate", sync_version as "syncVersion"
    FROM agent_prompt_templates
    WHERE agent_role = ${agentRole} AND model_id = ${modelId}
      AND template_type = 'system' AND active = true
      AND workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid
    LIMIT 1
  `.catch(() => []);

  const changeType = existing.length === 0 ? "created" : "updated";

  await upsertPromptTemplate({
    agentRole, modelId, templateType: "system",
    template: rewritten, canonicalTemplate: canonicalSystem,
    workspaceId,
  });

  // Also upsert output_format (no rewriting needed — these are structural)
  await upsertPromptTemplate({
    agentRole, modelId, templateType: "output_format",
    template: canonical.output_format,
    canonicalTemplate: canonical.output_format,
    workspaceId,
  });

  // Log the sync
  await sql`
    INSERT INTO prompt_sync_log (
      workspace_id, agent_role, model_id, template_type,
      change_type, prev_rate, notes
    ) VALUES (
      ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${agentRole}, ${modelId}, 'system',
      ${changeType}, ${existing[0]?.firstPassRate ?? null},
      ${changeType === "created" ? "First sync for this model" : "Nightly sync"}
    )
  `.catch(() => {});

  return { changeType };
}

export async function syncAllPromptTemplates(workspaceId?: string): Promise<{
  synced: number; created: number; updated: number;
}> {
  const roles: AgentRole[] = [
    "implementer", "verifier", "paranoid_reviewer",
    "ceo_reviewer", "chief_of_staff", "spec_compiler",
  ];
  const models = [
    "claude-sonnet-4-5-20251001",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-20250514",
  ];

  let created = 0;
  let updated = 0;

  for (const role of roles) {
    for (const model of models) {
      const { changeType } = await syncPromptTemplate(role, model, workspaceId).catch(() => ({ changeType: "no_change" as const }));
      if (changeType === "created") created++;
      if (changeType === "updated") updated++;
    }
  }

  return { synced: roles.length * models.length, created, updated };
}

export async function listPromptTemplates(workspaceId?: string): Promise<PromptTemplate[]> {
  const sql = getDb();
  try {
    return sql<PromptTemplate[]>`
      SELECT
        id, workspace_id as "workspaceId", agent_role as "agentRole",
        model_id as "modelId", template_type as "templateType",
        template, first_pass_rate as "firstPassRate",
        sample_count as "sampleCount", last_synced_at as "lastSyncedAt",
        sync_version as "syncVersion", active
      FROM agent_prompt_templates
      WHERE active = true
        AND (workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid
             OR workspace_id = '00000000-0000-0000-0000-000000000001'::uuid)
      ORDER BY agent_role, model_id, template_type
    `;
  } catch { return []; }
}
