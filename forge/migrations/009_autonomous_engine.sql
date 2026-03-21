-- Forge migration 009: autonomous engine + intelligence layers
--
-- Five systems:
-- 1. Daemon state machine — always-on self-healing process tracking
-- 2. Federated intelligence — privacy-preserving annotation sharing
-- 3. RL feedback guard — tournament scoring integrity log
-- 4. T34 data pipeline integrity — external feed tamper detection
-- 5. T35 personal agent surface — boundary enforcement between
--    the software factory and personal data (email, calendar, identity)

-- ─── 1. Daemon state machine ─────────────────────────────────────────────────
-- Tracks the always-on autonomous engine: what it's watching, what it found,
-- when it last ran, and whether it needs a human.

CREATE TABLE IF NOT EXISTS daemon_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  component       TEXT NOT NULL,  -- 'probe_runner' | 'graveyard_checker' | 'payroll' | 'pairing' | 'federation_sync' | 'pipeline_guard' | 'personal_surface_guard'
  status          TEXT NOT NULL DEFAULT 'idle' CHECK (status IN (
                    'idle', 'running', 'error', 'waiting_human', 'disabled'
                  )),
  last_run_at     TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  run_count       INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  -- Self-healing: auto-restart on transient errors
  consecutive_errors     INTEGER NOT NULL DEFAULT 0,
  max_consecutive_errors INTEGER NOT NULL DEFAULT 5,
  restart_count          INTEGER NOT NULL DEFAULT 0,
  -- Watchdog heartbeat
  heartbeat_at    TIMESTAMPTZ,
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 60000,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, component)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ds_workspace_status_idx
  ON daemon_state (workspace_id, status);

-- Daemon scan results (what the autonomous engine found)
CREATE TABLE IF NOT EXISTS daemon_scan_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE
                  DEFAULT '00000000-0000-0000-0000-000000000001',
  component     TEXT NOT NULL,
  scan_type     TEXT NOT NULL,  -- 'probe_anomaly' | 'agent_drift' | 'pipeline_tamper' | 'surface_violation' | 'federation_match'
  severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title         TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}',
  -- Resolution
  auto_resolved BOOLEAN NOT NULL DEFAULT false,
  human_required BOOLEAN NOT NULL DEFAULT false,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dsr_workspace_severity_idx
  ON daemon_scan_results (workspace_id, severity, created_at DESC)
  WHERE resolved_at IS NULL;

-- ─── 2. Federated intelligence ────────────────────────────────────────────────
-- Privacy-preserving annotation sharing across Forge deployments.
-- Only noisy aggregate signals leave a deployment — never raw content.
-- Differential privacy: Laplace noise (epsilon=0.1) on all counts.

CREATE TABLE IF NOT EXISTS federation_contributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  -- What we're contributing (noisy aggregate only — no raw content)
  domain          TEXT NOT NULL,
  pattern_type    TEXT NOT NULL,  -- maps to annotation content_type
  -- Noisy counts (Laplace noise applied before storage)
  verification_attempts_noisy  INTEGER NOT NULL DEFAULT 0,
  first_pass_rate_noisy        NUMERIC(5,4),  -- 0.0-1.0 with noise
  -- The contribution is a hash of the pattern, never the raw pattern
  pattern_fingerprint  TEXT NOT NULL,  -- SHA-256 of normalized pattern
  contributed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Federation global priors (pulled from the network, blended with local)
CREATE TABLE IF NOT EXISTS federation_priors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          TEXT NOT NULL,
  key_prefix      TEXT NOT NULL,  -- e.g. 'billing/', 'auth/'
  -- Blended signal from global federation
  global_first_pass_rate    NUMERIC(5,4),
  global_sample_count       INTEGER NOT NULL DEFAULT 0,
  local_weight              NUMERIC(3,2) NOT NULL DEFAULT 0.2,  -- 20% local at session 1, 80% at session 100
  -- Derived recommendations (what the global signal suggests)
  recommended_patterns      JSONB DEFAULT '[]',  -- top patterns by global success rate
  -- Freshness
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (domain, key_prefix)
);

CREATE INDEX IF NOT EXISTS fp_domain_idx ON federation_priors (domain, last_synced_at DESC);

-- Federation session tracking (how much local vs global to trust)
CREATE TABLE IF NOT EXISTS federation_session_trust (
  workspace_id    UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  session_count   INTEGER NOT NULL DEFAULT 0,  -- total agent sessions run
  local_weight    NUMERIC(3,2) NOT NULL DEFAULT 0.2,  -- starts at 0.2, converges to 0.8
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. RL feedback guard ─────────────────────────────────────────────────────
-- Monitors tournament scoring for gaming patterns.
-- An agent that games the scoring rubric is exploiting the reward signal.
-- Logs scoring anomalies and confidence classifications.

CREATE TABLE IF NOT EXISTS rl_scoring_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id           UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  agent_id        TEXT NOT NULL,
  -- Tournament context
  variant_count   INTEGER NOT NULL,
  winning_variant INTEGER NOT NULL,
  winning_score   NUMERIC(5,4) NOT NULL,
  -- Gaming detection signals
  score_variance        NUMERIC(7,4),  -- low variance across variants = suspiciously uniform
  test_claim_alignment  NUMERIC(5,4),  -- 0.0-1.0: are tests probing claims or implementation?
  implementation_diversity NUMERIC(5,4),  -- 0.0-1.0: are variants genuinely different?
  -- Classification
  regime          TEXT NOT NULL DEFAULT 'normal' CHECK (regime IN (
                    'normal', 'suspicious', 'gaming', 'inconclusive'
                  )),
  regime_reason   TEXT,
  -- Flags
  flagged_for_review  BOOLEAN NOT NULL DEFAULT false,
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rl_bu_idx ON rl_scoring_log (bu_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rl_regime_idx ON rl_scoring_log (workspace_id, regime, created_at DESC)
  WHERE regime IN ('suspicious', 'gaming');

-- ─── 4. T34 data pipeline integrity ──────────────────────────────────────────
-- Monitors external data feeds for tampering before agents act on them.
-- Detects statistical anomalies in inbound data distributions.

CREATE TABLE IF NOT EXISTS pipeline_feeds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  feed_name       TEXT NOT NULL,       -- e.g. 'fedex_routes', 'helix_cohort', 'stripe_webhooks'
  feed_url        TEXT,
  domain          TEXT NOT NULL,
  -- Baseline statistics (established over first 30 days)
  baseline_mean     NUMERIC,
  baseline_stddev   NUMERIC,
  baseline_samples  INTEGER NOT NULL DEFAULT 0,
  baseline_locked   BOOLEAN NOT NULL DEFAULT false,
  -- Monitoring
  check_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_checked_at   TIMESTAMPTZ,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_integrity_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id         UUID REFERENCES pipeline_feeds(id) ON DELETE CASCADE,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  -- The check
  sample_value    NUMERIC NOT NULL,
  z_score         NUMERIC,              -- deviation from baseline in std devs
  -- Verdict
  verdict         TEXT NOT NULL DEFAULT 'clean' CHECK (verdict IN (
                    'clean', 'anomaly', 'tamper_suspected', 'baseline_building'
                  )),
  anomaly_reason  TEXT,
  -- Chain of custody
  content_hash    TEXT,   -- SHA-256 of payload for tamper detection
  -- Response
  blocked_agent_action BOOLEAN NOT NULL DEFAULT false,  -- did we stop an agent from acting on this?
  escalated        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pic_feed_created_idx
  ON pipeline_integrity_checks (feed_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pic_tamper_idx
  ON pipeline_integrity_checks (workspace_id, verdict, created_at DESC)
  WHERE verdict IN ('anomaly', 'tamper_suspected');

-- ─── 5. T35 personal agent surface ───────────────────────────────────────────
-- Enforces the boundary between the software factory and personal data.
-- Prevents prompt-injection pivot from spec compilation → email/calendar access.
-- "One founder, five companies" requires hard isolation between workspaces
-- and personal data surfaces.

CREATE TABLE IF NOT EXISTS personal_surface_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  surface_type    TEXT NOT NULL CHECK (surface_type IN (
                    'email', 'calendar', 'identity', 'financial', 'contacts', 'files'
                  )),
  -- Access policy
  allowed_agents  JSONB DEFAULT '[]',   -- agent_ids explicitly permitted
  allowed_scopes  JSONB DEFAULT '[]',   -- e.g. ['read_calendar_availability']
  require_mfa     BOOLEAN NOT NULL DEFAULT true,
  -- Monitoring
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_surface_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  agent_id        TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  surface_type    TEXT NOT NULL,
  -- What was attempted
  action_type     TEXT NOT NULL,
  action_detail   JSONB NOT NULL DEFAULT '{}',
  -- Source tracing (was this from a prompt injection chain?)
  originating_bu_id    UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  injection_suspected  BOOLEAN NOT NULL DEFAULT false,
  injection_evidence   TEXT,
  -- Decision
  verdict         TEXT NOT NULL CHECK (verdict IN ('allowed', 'blocked', 'requires_mfa')),
  block_reason    TEXT,
  -- Chain of trust
  trust_chain     JSONB DEFAULT '[]',  -- [{agent_id, role, action}] — how we got here
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pse_workspace_verdict_idx
  ON personal_surface_events (workspace_id, verdict, created_at DESC)
  WHERE verdict != 'allowed';
CREATE INDEX IF NOT EXISTS pse_injection_idx
  ON personal_surface_events (injection_suspected, created_at DESC)
  WHERE injection_suspected = true;

-- ─── Daemon health view ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_daemon_health AS
  SELECT
    ws.slug                                                       AS workspace,
    ds.component,
    ds.status,
    ds.last_success_at,
    ds.consecutive_errors,
    ds.restart_count,
    EXTRACT(EPOCH FROM (NOW() - ds.heartbeat_at)) / 60           AS minutes_since_heartbeat,
    CASE
      WHEN ds.status = 'error'    THEN 'critical'
      WHEN ds.consecutive_errors >= 3 THEN 'warning'
      WHEN ds.heartbeat_at < NOW() - INTERVAL '10 minutes' THEN 'warning'
      ELSE 'healthy'
    END                                                           AS health
  FROM daemon_state ds
  JOIN workspaces ws ON ws.id = ds.workspace_id
  ORDER BY health DESC, ws.slug, ds.component;
