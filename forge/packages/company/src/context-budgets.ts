/**
 * Domain thread context budget enforcement.
 *
 * Prevents context rot as the annotation store grows.
 * Each domain has a token budget for annotation injection.
 * When the budget is full, low-confidence annotations are pruned.
 * The implementer only gets the highest-value annotations within budget.
 *
 * "Context rot is not a window size problem. It's a garbage problem."
 */

import { getDb } from "@forge/db";
import { getAnnotationsForDomain, formatAnnotationsForPrompt, deactivateAnnotation } from "@forge/intent-graph";
import type { DomainAnnotation } from "@forge/types";

export interface DomainThread {
  id: string;
  workspaceId: string;
  domain: string;
  maxAnnotationTokens: number;
  maxHistoryTokens: number;
  maxTotalContextTokens: number;
  annotationSort: "confidence_desc" | "recency_desc" | "usage_desc" | "mixed";
  currentAnnotationCount: number;
  currentAnnotationTokens: number;
  lastPrunedAt?: string;
  enabled: boolean;
}

export interface BudgetedAnnotationResult {
  annotations: DomainAnnotation[];
  annotationContext: string;
  tokensUsed: number;
  tokensBudget: number;
  pruned: number;
  budgetExceeded: boolean;
}

// Rough token estimate: 1 token ≈ 4 chars
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Domain thread config ─────────────────────────────────────────────────────

export async function getDomainThread(
  domain: string,
  workspaceId?: string
): Promise<DomainThread | null> {
  const sql = getDb();
  try {
    const rows = await sql<DomainThread[]>`
      SELECT
        id, workspace_id as "workspaceId", domain,
        max_annotation_tokens as "maxAnnotationTokens",
        max_history_tokens as "maxHistoryTokens",
        max_total_context_tokens as "maxTotalContextTokens",
        annotation_sort as "annotationSort",
        current_annotation_count as "currentAnnotationCount",
        current_annotation_tokens as "currentAnnotationTokens",
        last_pruned_at as "lastPrunedAt", enabled
      FROM domain_threads
      WHERE domain = ${domain}
        AND (workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid
             OR workspace_id = '00000000-0000-0000-0000-000000000001'::uuid)
        AND enabled = true
      ORDER BY workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch { return null; }
}

export async function upsertDomainThread(input: {
  domain: string;
  workspaceId?: string;
  maxAnnotationTokens?: number;
  maxHistoryTokens?: number;
  maxTotalContextTokens?: number;
  annotationSort?: "confidence_desc" | "recency_desc" | "usage_desc" | "mixed";
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO domain_threads (
      workspace_id, domain, max_annotation_tokens,
      max_history_tokens, max_total_context_tokens, annotation_sort
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.domain},
      ${input.maxAnnotationTokens ?? 2000},
      ${input.maxHistoryTokens ?? 4000},
      ${input.maxTotalContextTokens ?? 8000},
      ${input.annotationSort ?? "confidence_desc"}
    )
    ON CONFLICT (workspace_id, domain) DO UPDATE SET
      max_annotation_tokens = COALESCE(EXCLUDED.max_annotation_tokens, domain_threads.max_annotation_tokens),
      max_history_tokens = COALESCE(EXCLUDED.max_history_tokens, domain_threads.max_history_tokens),
      annotation_sort = COALESCE(EXCLUDED.annotation_sort, domain_threads.annotation_sort),
      updated_at = NOW()
  `.catch(() => {});
}

// ─── Budget-aware annotation injection ────────────────────────────────────────
// The core function: fetch annotations for a domain, apply the budget,
// return only what fits, log what was pruned.

export async function getBudgetedAnnotations(
  domain: string,
  agentId: string,
  agentRole: string,
  buId?: string,
  workspaceId?: string
): Promise<BudgetedAnnotationResult> {
  const thread = await getDomainThread(domain, workspaceId);
  const maxTokens = thread?.maxAnnotationTokens ?? 2000;
  const sort = thread?.annotationSort ?? "confidence_desc";

  // Fetch all active annotations for domain
  const allAnnotations = await getAnnotationsForDomain(domain, 50); // fetch more, then trim

  // Sort per thread config
  const sorted = sortAnnotations(allAnnotations, sort);

  // Apply budget: fit as many as possible within token limit
  let tokensUsed = 0;
  const fitting: DomainAnnotation[] = [];
  let pruned = 0;

  for (const annotation of sorted) {
    const formatted = `### ${annotation.title} [${annotation.key}]\n${annotation.content}\n\n`;
    const tokens = estimateTokens(formatted);

    if (tokensUsed + tokens <= maxTokens) {
      fitting.push(annotation);
      tokensUsed += tokens;
    } else {
      pruned++;
    }
  }

  const budgetExceeded = pruned > 0 && allAnnotations.length > 0;
  const annotationContext = formatAnnotationsForPrompt(fitting);

  // Log context budget usage
  await logBudgetUsage({
    domain, agentId, agentRole, buId,
    annotationsInjected: fitting.length,
    annotationTokensUsed: tokensUsed,
    totalContextTokens: tokensUsed,
    budgetExceeded, tokensPruned: pruned,
    workspaceId,
  });

  // Update thread stats
  const sql = getDb();
  await sql`
    UPDATE domain_threads SET
      current_annotation_count = ${fitting.length},
      current_annotation_tokens = ${tokensUsed},
      updated_at = NOW()
    WHERE domain = ${domain}
      AND workspace_id = ${workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid
  `.catch(() => {});

  return {
    annotations: fitting,
    annotationContext,
    tokensUsed,
    tokensBudget: maxTokens,
    pruned,
    budgetExceeded,
  };
}

function sortAnnotations(
  annotations: DomainAnnotation[],
  sort: "confidence_desc" | "recency_desc" | "usage_desc" | "mixed"
): DomainAnnotation[] {
  const copy = [...annotations];
  switch (sort) {
    case "confidence_desc":
      return copy.sort((a, b) => b.confidence - a.confidence);
    case "recency_desc":
      return copy.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    case "usage_desc":
      return copy.sort((a, b) => b.timesUsed - a.timesUsed);
    case "mixed":
      // Blend: confidence × 0.5 + usage_normalized × 0.3 + recency_normalized × 0.2
      const maxUsage = Math.max(...annotations.map((a) => a.timesUsed), 1);
      const now = Date.now();
      const maxAge = 30 * 86400 * 1000; // 30 days
      return copy.sort((a, b) => {
        const scoreA = a.confidence * 0.5
          + (a.timesUsed / maxUsage) * 0.3
          + Math.max(0, 1 - (now - new Date(a.createdAt).getTime()) / maxAge) * 0.2;
        const scoreB = b.confidence * 0.5
          + (b.timesUsed / maxUsage) * 0.3
          + Math.max(0, 1 - (now - new Date(b.createdAt).getTime()) / maxAge) * 0.2;
        return scoreB - scoreA;
      });
    default:
      return copy;
  }
}

async function logBudgetUsage(input: {
  domain: string; agentId: string; agentRole: string; buId?: string;
  annotationsInjected: number; annotationTokensUsed: number;
  totalContextTokens: number; budgetExceeded: boolean; tokensPruned: number;
  workspaceId?: string;
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO context_budget_log (
      workspace_id, domain, agent_id, agent_role, bu_id,
      annotations_injected, annotation_tokens_used, total_context_tokens,
      budget_exceeded, tokens_pruned
    ) VALUES (
      ${input.workspaceId ?? "00000000-0000-0000-0000-000000000001"}::uuid,
      ${input.domain}, ${input.agentId}, ${input.agentRole},
      ${input.buId ?? null}::uuid,
      ${input.annotationsInjected}, ${input.annotationTokensUsed},
      ${input.totalContextTokens}, ${input.budgetExceeded}, ${input.tokensPruned}
    )
  `.catch(() => {});
}

// ─── Annotation pruning ───────────────────────────────────────────────────────
// Called by the weekly annotation_prune job.
// Deactivates annotations that: are low confidence, haven't been used in 90 days,
// and have been superseded by higher-confidence versions of the same key.

export async function pruneAnnotations(workspaceId?: string): Promise<{
  checked: number; deactivated: number;
}> {
  const sql = getDb();
  let deactivated = 0;

  try {
    // Find annotations that are stale: low confidence + not used in 90 days
    const stale = await sql<Array<{ id: string; key: string; domain: string }>>`
      SELECT id, key, domain FROM domain_annotations
      WHERE active = true
        AND confidence < 0.5
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '90 days')
        AND created_at < NOW() - INTERVAL '30 days'
      LIMIT 50
    `;

    for (const annotation of stale) {
      // Only deactivate if there's a higher-confidence version of the same key
      const better = await sql<Array<{ count: number }>>`
        SELECT COUNT(*) as count FROM domain_annotations
        WHERE key = ${annotation.key} AND domain = ${annotation.domain}
          AND confidence >= 0.8 AND active = true
          AND id != ${annotation.id}
      `;
      if (Number(better[0]?.count ?? 0) > 0) {
        await deactivateAnnotation(annotation.id);
        deactivated++;
      }
    }

    return { checked: stale.length, deactivated };
  } catch {
    return { checked: 0, deactivated: 0 };
  }
}

export async function getContextBudgetHealth(workspaceId?: string): Promise<Array<{
  workspace: string; domain: string; maxAnnotationTokens: number;
  currentAnnotationTokens: number; pctUsed: number; budgetHealth: string;
}>> {
  const sql = getDb();
  try {
    return sql<Array<{
      workspace: string; domain: string; maxAnnotationTokens: number;
      currentAnnotationTokens: number; pctUsed: number; budgetHealth: string;
    }>>`
      SELECT workspace, domain,
             "maxAnnotationTokens", "currentAnnotationTokens",
             "pctUsed", "budgetHealth"
      FROM v_context_budget_health
      WHERE (${workspaceId ?? null}::uuid IS NULL
             OR workspace_id = ${workspaceId ?? null}::uuid)
    `;
  } catch { return []; }
}
