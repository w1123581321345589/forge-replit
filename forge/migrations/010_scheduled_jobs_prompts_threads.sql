-- Forge migration 010: scheduled jobs, prompt templates, domain thread budgets
--
-- Three systems:
-- 1. scheduled_jobs     — configurable cron jobs, replaces hardcoded scheduler logic
-- 2. agent_prompt_templates — per-model prompt optimization with nightly sync
-- 3. domain_threads     — per-domain context channels with token budget caps
--                         (prevents context rot as annotation store grows)

-- ─── 1. Scheduled jobs ────────────────────────────────────────────────────────
-- Turns hardcoded daemon loops into runtime-configurable jobs.
-- The scheduler reads from this table on each tick instead of fixed logic.
-- Command Center can create/modify/disable schedules without code changes.

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  job_type        TEXT NOT NULL CHECK (job_type IN (
                    -- Built-in job types
                    'behavioral_discovery',   -- scan production traffic for undocumented BUs
                    'graveyard_check',        -- check idea graveyard for revival candidates
                    'payroll_compute',        -- compute weekly agent credits
                    'cross_workspace_pairing', -- Wednesday coffee pairings
                    'federation_sync',        -- contribute to + pull from global federation
                    'probe_run',              -- run production probes for a domain
                    'prompt_sync',            -- sync prompt templates to model-optimal versions
                    'annotation_prune',       -- deactivate low-confidence stale annotations
                    'digest_generate',        -- generate CoS digest
                    'pipeline_integrity',     -- check external feed baselines
                    'custom'                  -- custom job via spec text
                  )),
  -- Scheduling
  cron_expression TEXT NOT NULL,  -- standard 5-field cron: "0 20 * * 0" = Sunday 8pm
  timezone        TEXT NOT NULL DEFAULT 'America/New_York',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  -- Job config (domain/workspace filters, custom spec, etc.)
  config          JSONB NOT NULL DEFAULT '{}',
  -- Execution state
  last_run_at     TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  run_count       INTEGER NOT NULL DEFAULT 0,
  next_run_at     TIMESTAMPTZ,
  -- Metadata
  name            TEXT NOT NULL,
  description     TEXT,
  created_by      TEXT NOT NULL DEFAULT 'human',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sj_workspace_enabled_idx
  ON scheduled_jobs (workspace_id, enabled, next_run_at)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS sj_next_run_idx
  ON scheduled_jobs (next_run_at)
  WHERE enabled = true;

-- Seed default jobs for all existing workspaces
INSERT INTO scheduled_jobs (workspace_id, job_type, cron_expression, name, description, config)
SELECT
  id,
  job_type,
  cron_expression,
  name,
  description,
  config::jsonb
FROM workspaces
CROSS JOIN (VALUES
  ('graveyard_check',        '0 20 * * 0', 'Weekly graveyard check',          'Check idea graveyard for revival candidates', '{}'),
  ('payroll_compute',        '0 8 * * 1',  'Monday payroll',                  'Compute weekly agent credits',                '{}'),
  ('cross_workspace_pairing','0 10 * * 3', 'Wednesday coffee pairings',       'Cross-workspace knowledge exchange',          '{}'),
  ('federation_sync',        '0 2 * * *',  'Nightly federation sync',         'Contribute to and pull from global federation','{}'),
  ('prompt_sync',            '0 3 * * *',  'Nightly prompt template sync',    'Sync agent prompts to model-optimal versions','{}'),
  ('digest_generate',        '0 9 * * *',  'Morning CoS digest',              'Generate 9am chief-of-staff digest',          '{"time": "morning"}'),
  ('digest_generate',        '0 16 * * *', 'Afternoon CoS digest',            'Generate 4pm chief-of-staff digest',          '{"time": "afternoon"}'),
  ('annotation_prune',       '0 4 * * 0',  'Weekly annotation prune',         'Deactivate stale low-confidence annotations', '{}')
) AS defaults(job_type, cron_expression, name, description, config)
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_jobs sj
  WHERE sj.workspace_id = workspaces.id
    AND sj.job_type = defaults.job_type
    AND sj.name = defaults.name
);

-- ─── 2. Agent prompt templates ────────────────────────────────────────────────
-- Per-model prompt optimization. The same instruction set formatted
-- differently per model. Nightly sync keeps versions current.
-- Each (agent_role, model_id) pair has its own optimized template.

CREATE TABLE IF NOT EXISTS agent_prompt_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  agent_role      TEXT NOT NULL,   -- implementer | verifier | paranoid_reviewer | ceo_reviewer | chief_of_staff
  model_id        TEXT NOT NULL,   -- claude-sonnet-4-5-20251001 | claude-haiku-4-5-20251001 | gpt-4o | etc.
  template_type   TEXT NOT NULL CHECK (template_type IN (
                    'system',       -- system prompt / persona
                    'user_prefix',  -- prepended to every user turn
                    'output_format' -- how to format the response
                  )),
  -- The template (supports {{variable}} interpolation)
  template        TEXT NOT NULL,
  -- Source of truth (the canonical template these are derived from)
  canonical_template TEXT,
  -- Quality signal — did this template produce better outputs?
  first_pass_rate NUMERIC(5,4),    -- 0.0-1.0 from verification results
  sample_count    INTEGER NOT NULL DEFAULT 0,
  -- Sync state
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_version    INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT true,
  -- Metadata
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, agent_role, model_id, template_type, active)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS apt_role_model_idx
  ON agent_prompt_templates (agent_role, model_id, active)
  WHERE active = true;

-- Prompt sync log (tracks what changed each nightly run)
CREATE TABLE IF NOT EXISTS prompt_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  agent_role      TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  template_type   TEXT NOT NULL,
  change_type     TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'no_change', 'degraded')),
  prev_rate       NUMERIC(5,4),
  new_rate        NUMERIC(5,4),
  notes           TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Domain thread context budgets ────────────────────────────────────────
-- Per-domain context channels. Each domain gets its own conversation thread
-- with a token budget cap. Prevents context rot as the annotation store grows.
-- The implementer only sees annotations relevant to its current domain thread.

CREATE TABLE IF NOT EXISTS domain_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  domain          TEXT NOT NULL,
  -- Context budget (in tokens — prevents injection bloat)
  max_annotation_tokens    INTEGER NOT NULL DEFAULT 2000,
  max_history_tokens       INTEGER NOT NULL DEFAULT 4000,
  max_total_context_tokens INTEGER NOT NULL DEFAULT 8000,
  -- Priority ordering for annotation injection
  annotation_sort         TEXT NOT NULL DEFAULT 'confidence_desc' CHECK (annotation_sort IN (
                            'confidence_desc', 'recency_desc', 'usage_desc', 'mixed'
                          )),
  -- Current usage stats
  current_annotation_count INTEGER NOT NULL DEFAULT 0,
  current_annotation_tokens INTEGER NOT NULL DEFAULT 0,
  last_pruned_at  TIMESTAMPTZ,
  -- Thread config
  enabled         BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, domain)
);

CREATE INDEX IF NOT EXISTS dt_workspace_domain_idx
  ON domain_threads (workspace_id, domain)
  WHERE enabled = true;

-- Context budget usage log (track what gets injected per agent run)
CREATE TABLE IF NOT EXISTS context_budget_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  domain          TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  bu_id           UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  -- What was injected
  annotations_injected     INTEGER NOT NULL DEFAULT 0,
  annotation_tokens_used   INTEGER NOT NULL DEFAULT 0,
  federation_tokens_used   INTEGER NOT NULL DEFAULT 0,
  total_context_tokens     INTEGER NOT NULL DEFAULT 0,
  -- Was budget exceeded?
  budget_exceeded          BOOLEAN NOT NULL DEFAULT false,
  tokens_pruned            INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cbl_domain_agent_idx
  ON context_budget_log (domain, agent_id, created_at DESC);

-- ─── Seed default domain threads for existing workspaces ─────────────────────
-- Each company's domains get sensible defaults based on domain complexity.

INSERT INTO domain_threads (workspace_id, domain, max_annotation_tokens, max_history_tokens, notes)
SELECT
  ws.id,
  domain_config.domain,
  domain_config.max_annotation_tokens,
  domain_config.max_history_tokens,
  domain_config.notes
FROM workspaces ws
CROSS JOIN (VALUES
  -- High-stakes domains: smaller annotation budget, stricter context control
  ('security',     1500, 3000, 'Security domain — tight context to prevent noise'),
  ('compliance',   1500, 3000, 'Compliance domain — audit-relevant context only'),
  ('auth',         1500, 3000, 'Auth domain — minimal context, high precision needed'),
  -- Core product domains: standard budget
  ('core',         2000, 4000, 'Core product domain'),
  ('billing',      2000, 4000, 'Billing domain'),
  ('fintech',      2000, 4000, 'Fintech domain'),
  -- Operations domains: larger budget, more history
  ('operations',   3000, 6000, 'Ops domain — more context helps with complex workflows'),
  ('instruction',  3000, 6000, 'Instruction domain — pedagogical context is deep'),
  -- Default catch-all
  ('general',      2000, 4000, 'Default domain thread'),
  ('oncology',     3000, 6000, 'Clinical domain — complex scientific context')
) AS domain_config(domain, max_annotation_tokens, max_history_tokens, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM domain_threads dt
  WHERE dt.workspace_id = ws.id AND dt.domain = domain_config.domain
);

-- ─── Views ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_due_jobs AS
  SELECT
    sj.*,
    ws.slug AS workspace_slug
  FROM scheduled_jobs sj
  JOIN workspaces ws ON ws.id = sj.workspace_id
  WHERE sj.enabled = true
    AND (sj.next_run_at IS NULL OR sj.next_run_at <= NOW())
  ORDER BY sj.next_run_at ASC NULLS FIRST;

CREATE OR REPLACE VIEW v_context_budget_health AS
  SELECT
    dt.workspace_id,
    ws.slug AS workspace,
    dt.domain,
    dt.max_annotation_tokens,
    dt.current_annotation_tokens,
    ROUND(dt.current_annotation_tokens::numeric / NULLIF(dt.max_annotation_tokens, 0) * 100) AS pct_used,
    dt.current_annotation_count,
    dt.last_pruned_at,
    CASE
      WHEN dt.current_annotation_tokens > dt.max_annotation_tokens * 0.9 THEN 'critical'
      WHEN dt.current_annotation_tokens > dt.max_annotation_tokens * 0.7 THEN 'warning'
      ELSE 'healthy'
    END AS budget_health
  FROM domain_threads dt
  JOIN workspaces ws ON ws.id = dt.workspace_id
  WHERE dt.enabled = true
  ORDER BY pct_used DESC NULLS LAST;
