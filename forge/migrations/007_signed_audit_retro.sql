-- Forge migration 007: signed audit trail + cost views + retro
--
-- Three things in one migration:
--
-- 1. HMAC signature on agent_actions — each row gets a cryptographic
--    signature over its content tuple. Required for Aiglos/DoD compliance.
--    Verifiable without trusting the database operator.
--
-- 2. v_cost_per_bu — token cost rolled up per behavioral unit, per domain.
--    Powers `forge cost` command.
--
-- 3. v_weekly_retro — the engineering retrospective view. Answers:
--    which domains improved, which regressed, what did things cost,
--    where did agents get stuck. Powers `forge retro`.

-- ─── 1. Signed audit trail ────────────────────────────────────────────────────

ALTER TABLE agent_actions
  ADD COLUMN IF NOT EXISTS signature TEXT;  -- HMAC-SHA256 of canonical action JSON

-- Index for signature verification queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS aa_signature_idx
  ON agent_actions (signature)
  WHERE signature IS NOT NULL;

-- ─── 2. Cost-per-BU view ──────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_cost_per_bu AS
  SELECT
    bu.id                                                          AS bu_id,
    bu.claim,
    bu.domain,
    bu.status,
    COUNT(mc.id)                                                   AS model_call_count,
    COALESCE(SUM(mc.input_tokens + mc.output_tokens), 0)           AS total_tokens,
    COALESCE(SUM(mc.cost_usd), 0)                                  AS total_cost_usd,
    COALESCE(AVG(mc.cost_usd), 0)                                  AS avg_cost_per_call,
    MAX(mc.created_at)                                             AS last_call_at
  FROM behavioral_units bu
  LEFT JOIN model_calls mc ON mc.bu_id = bu.id
  GROUP BY bu.id, bu.claim, bu.domain, bu.status;

CREATE OR REPLACE VIEW v_cost_per_domain AS
  SELECT
    bu.domain,
    COUNT(DISTINCT bu.id)                                          AS bu_count,
    COUNT(mc.id)                                                   AS model_call_count,
    COALESCE(SUM(mc.input_tokens + mc.output_tokens), 0)           AS total_tokens,
    COALESCE(SUM(mc.cost_usd), 0)                                  AS total_cost_usd,
    COALESCE(AVG(mc.cost_usd), 0)                                  AS avg_cost_per_bu,
    -- Most expensive single BU in the domain
    MAX(sub.bu_total)                                              AS max_bu_cost
  FROM behavioral_units bu
  LEFT JOIN model_calls mc ON mc.bu_id = bu.id
  LEFT JOIN (
    SELECT bu_id, SUM(cost_usd) AS bu_total FROM model_calls GROUP BY bu_id
  ) sub ON sub.bu_id = bu.id
  GROUP BY bu.domain;

-- ─── 3. Weekly retro view ──────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_weekly_retro AS
  WITH
    period AS (
      SELECT
        NOW() - INTERVAL '7 days' AS week_start,
        NOW()                      AS week_end
    ),
    bu_stats AS (
      SELECT
        bu.domain,
        COUNT(*) FILTER (WHERE bu.status = 'verified')              AS verified_this_week,
        COUNT(*) FILTER (WHERE bu.status = 'deployed')              AS deployed_this_week,
        COUNT(*) FILTER (WHERE bu.status = 'needs_reverification')  AS needs_reverif,
        COUNT(*)                                                     AS total_bus
      FROM behavioral_units bu, period p
      WHERE bu.updated_at BETWEEN p.week_start AND p.week_end
      GROUP BY bu.domain
    ),
    gap_stats AS (
      SELECT
        bu.domain,
        ag.gap_type,
        COUNT(*)                                                     AS gap_count,
        COUNT(*) FILTER (WHERE ag.resolved_at IS NOT NULL)          AS resolved_count
      FROM autonomy_gaps ag
      JOIN behavioral_units bu ON bu.id = ag.bu_id
      CROSS JOIN period p
      WHERE ag.created_at BETWEEN p.week_start AND p.week_end
      GROUP BY bu.domain, ag.gap_type
    ),
    verif_stats AS (
      SELECT
        bu.domain,
        COUNT(*) FILTER (WHERE vr.overall_satisfaction = 'satisfied')    AS satisfied,
        COUNT(*) FILTER (WHERE vr.overall_satisfaction = 'violated')     AS violated,
        COUNT(*) FILTER (WHERE vr.overall_satisfaction = 'partial')      AS partial,
        COUNT(*)                                                          AS total_verifs
      FROM verification_results vr
      JOIN behavioral_units bu ON bu.id = vr.bu_id
      CROSS JOIN period p
      WHERE vr.created_at BETWEEN p.week_start AND p.week_end
      GROUP BY bu.domain
    ),
    cost_stats AS (
      SELECT
        bu.domain,
        COALESCE(SUM(mc.input_tokens + mc.output_tokens), 0)  AS tokens_used,
        COALESCE(SUM(mc.cost_usd), 0)                         AS cost_usd
      FROM model_calls mc
      JOIN behavioral_units bu ON bu.id = mc.bu_id
      CROSS JOIN period p
      WHERE mc.created_at BETWEEN p.week_start AND p.week_end
      GROUP BY bu.domain
    ),
    annotation_stats AS (
      SELECT
        domain,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')  AS new_this_week,
        SUM(times_used) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days') AS uses_this_week
      FROM domain_annotations
      WHERE active = true
      GROUP BY domain
    )
  SELECT
    COALESCE(b.domain, g.domain, v.domain, c.domain)   AS domain,
    COALESCE(b.verified_this_week, 0)                   AS verified,
    COALESCE(b.deployed_this_week, 0)                   AS deployed,
    COALESCE(b.needs_reverif, 0)                        AS needs_reverification,
    COALESCE(v.satisfied, 0)                            AS verif_satisfied,
    COALESCE(v.violated, 0)                             AS verif_violated,
    COALESCE(v.total_verifs, 0)                         AS total_verifications,
    -- First-pass satisfaction rate
    CASE WHEN COALESCE(v.total_verifs, 0) > 0
      THEN ROUND(COALESCE(v.satisfied, 0)::NUMERIC / v.total_verifs * 100)
      ELSE NULL
    END                                                 AS satisfaction_pct,
    COALESCE(c.tokens_used, 0)                          AS tokens_used,
    COALESCE(c.cost_usd, 0)                             AS cost_usd,
    COALESCE(a.new_this_week, 0)                        AS new_annotations,
    COALESCE(a.uses_this_week, 0)                       AS annotation_uses
  FROM bu_stats b
  FULL JOIN verif_stats v  ON v.domain = b.domain
  FULL JOIN cost_stats c   ON c.domain = COALESCE(b.domain, v.domain)
  FULL JOIN annotation_stats a ON a.domain = COALESCE(b.domain, v.domain, c.domain)
  FULL JOIN gap_stats g    ON g.domain = COALESCE(b.domain, v.domain, c.domain, a.domain)
  ORDER BY COALESCE(b.verified_this_week, 0) DESC;
