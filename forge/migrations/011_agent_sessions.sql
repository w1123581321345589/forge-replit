-- Forge migration 011: agent session persistence
--
-- The OpenClaw insight: a 2-hour default idle timeout makes agents feel
-- forgetful. Most users never find the setting. The default IS the product.
--
-- Forge sessions are explicit, configurable, and surfaced through the
-- normal scheduled job system. Every default is visible in forge schedule --list.
--
-- Four tables:
-- 1. agent_sessions        — persistent session state per (workspace, domain, role)
-- 2. session_context_items — structured in-session learnings (not formal annotations)
-- 3. session_handoffs      — when a session expires, what did the next session inherit
-- 4. session_expiry_log    — audit trail of what was auto-closed vs extended

-- ─── 1. Agent sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  domain          TEXT NOT NULL,
  agent_role      TEXT NOT NULL,   -- implementer | verifier | paranoid_reviewer | etc.
  agent_id        TEXT NOT NULL,   -- specific agent instance
  -- Status
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                    'active',      -- currently working
                    'idle',        -- not working but session alive
                    'expired',     -- past idle threshold, auto-closed
                    'extended',    -- human explicitly extended
                    'closed',      -- human explicitly closed
                    'graveyarded'  -- converted to graveyard entry
                  )),
  -- Idle threshold (the critical default — not 2 hours, 4 days)
  idle_threshold_minutes INTEGER NOT NULL DEFAULT 5760,  -- 4 days = 5760 minutes
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ GENERATED ALWAYS AS (
    last_active_at + (idle_threshold_minutes * INTERVAL '1 minute')
  ) STORED,
  -- What this session has been working on
  current_bu_id   UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  -- In-session context (survives idle, dies at expiry)
  -- This is informal knowledge — not formal annotations
  session_summary TEXT,            -- "Working on Stripe webhook handling in billing domain"
  partial_context JSONB DEFAULT '{}',  -- {lastAttempt, blockers, humanSaid, tried, nextSteps}
  -- Metrics
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_attempted INTEGER NOT NULL DEFAULT 0,
  annotations_created INTEGER NOT NULL DEFAULT 0,
  escalations_surfaced INTEGER NOT NULL DEFAULT 0,
  -- Provenance
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS as_workspace_domain_role_idx
  ON agent_sessions (workspace_id, domain, agent_role, status);
CREATE INDEX IF NOT EXISTS as_expires_at_idx
  ON agent_sessions (expires_at)
  WHERE status IN ('active', 'idle', 'extended');
CREATE INDEX IF NOT EXISTS as_agent_active_idx
  ON agent_sessions (agent_id, status)
  WHERE status IN ('active', 'idle');

-- ─── 2. Session context items (in-session informal knowledge) ─────────────────
-- Captured during the session but not promoted to formal domain annotations.
-- Things like: "tried approach A, failed because X", "human said to use Y pattern",
-- "discovered Z edge case that needs to be handled".
-- Survives session idle. Expires with the session.

CREATE TABLE IF NOT EXISTS session_context_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  item_type       TEXT NOT NULL CHECK (item_type IN (
                    'attempted',    -- "tried X, failed because Y"
                    'human_said',   -- what the operator said in last escalation
                    'discovered',   -- new edge case or constraint found in-session
                    'blocked_on',   -- what this session is currently stuck on
                    'next_step',    -- what to try next
                    'learned'       -- informal learning not yet a formal annotation
                  )),
  content         TEXT NOT NULL,
  bu_id           UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  -- Promotion tracking — can be elevated to formal domain annotation
  promoted        BOOLEAN NOT NULL DEFAULT false,
  annotation_id   UUID,  -- if promoted, the annotation it became
  confidence      NUMERIC(3,2) DEFAULT 0.6,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sci_session_idx ON session_context_items (session_id, item_type);
CREATE INDEX IF NOT EXISTS sci_promotable_idx ON session_context_items (session_id)
  WHERE promoted = false AND confidence >= 0.7;

-- ─── 3. Session handoffs ──────────────────────────────────────────────────────
-- When a session expires and a new one starts for the same (domain, role),
-- the most valuable in-session context is handed forward.
-- Like the "briefing note" a colleague writes before going on vacation.

CREATE TABLE IF NOT EXISTS session_handoffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  to_session_id   UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  domain          TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  -- The handoff note (generated at session close)
  handoff_note    TEXT NOT NULL,   -- "Left off implementing Stripe webhook handler. Tried approach A (failed — idempotency issue). Next: approach B using transaction wrapper. Human said to check existing billing domain annotations."
  context_items_forwarded INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Session expiry log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_expiry_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  domain          TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN (
                    'expired_auto',   -- auto-expired by daemon
                    'extended_human', -- human explicitly extended
                    'closed_human',   -- human explicitly closed
                    'graveyarded'     -- partial work sent to idea graveyard
                  )),
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  context_items   INTEGER NOT NULL DEFAULT 0,
  annotations_promoted INTEGER NOT NULL DEFAULT 0,
  acted_by        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Add session_expiry_check to scheduled job types ─────────────────────────
-- Alter the check constraint to include the new job type

ALTER TABLE scheduled_jobs
  DROP CONSTRAINT IF EXISTS scheduled_jobs_job_type_check;

ALTER TABLE scheduled_jobs
  ADD CONSTRAINT scheduled_jobs_job_type_check CHECK (job_type IN (
    'behavioral_discovery', 'graveyard_check', 'payroll_compute',
    'cross_workspace_pairing', 'federation_sync', 'probe_run',
    'prompt_sync', 'annotation_prune', 'digest_generate',
    'pipeline_integrity', 'session_expiry_check', 'custom'
  ));

-- Seed the session expiry check job for all workspaces
INSERT INTO scheduled_jobs (workspace_id, job_type, cron_expression, name, description, config)
SELECT
  id,
  'session_expiry_check',
  '0 * * * *',
  'Hourly session expiry check',
  'Surface expiring agent sessions to CoS inbox — extend or close?',
  '{"warn_hours_before": 2}'::jsonb
FROM workspaces
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_jobs sj
  WHERE sj.workspace_id = workspaces.id
    AND sj.job_type = 'session_expiry_check'
);

-- ─── Views ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_active_sessions AS
  SELECT
    s.id,
    ws.slug                                                   AS workspace,
    s.domain,
    s.agent_role,
    s.agent_id,
    s.status,
    s.session_summary,
    s.tasks_completed,
    s.tasks_attempted,
    s.last_active_at,
    s.expires_at,
    EXTRACT(EPOCH FROM (s.expires_at - NOW())) / 3600         AS hours_until_expiry,
    EXTRACT(EPOCH FROM (NOW() - s.last_active_at)) / 60       AS minutes_idle,
    COUNT(sci.id)                                             AS context_items,
    COUNT(sci.id) FILTER (WHERE sci.promoted = false
      AND sci.confidence >= 0.7)                              AS promotable_items
  FROM agent_sessions s
  JOIN workspaces ws ON ws.id = s.workspace_id
  LEFT JOIN session_context_items sci ON sci.session_id = s.id
  WHERE s.status IN ('active', 'idle', 'extended')
  GROUP BY s.id, ws.slug
  ORDER BY s.expires_at ASC;

CREATE OR REPLACE VIEW v_expiring_sessions AS
  SELECT * FROM v_active_sessions
  WHERE hours_until_expiry <= 2
  ORDER BY hours_until_expiry ASC;
