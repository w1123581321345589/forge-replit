-- Forge migration 004: production behavioral probes
-- Deployed BUs become continuous production health checks.
-- Every acceptance criterion becomes a probe that runs on schedule
-- against your live system. When production violates a claim, the
-- BU cascades to needs_reverification and escalates to the CoS inbox.

-- ─── Probe schedules ─────────────────────────────────────────────────────────
-- One row per deployed BU being monitored.

CREATE TABLE IF NOT EXISTS probe_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id               UUID NOT NULL REFERENCES behavioral_units(id) ON DELETE CASCADE,
  interval_seconds    INTEGER NOT NULL DEFAULT 300,   -- default: every 5 minutes
  production_url      TEXT NOT NULL,                  -- e.g. https://api.myapp.com
  headers             JSONB DEFAULT '{}',             -- auth headers, API keys
  enabled             BOOLEAN NOT NULL DEFAULT true,
  last_run_at         TIMESTAMPTZ,
  next_run_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bu_id, production_url)
);

CREATE INDEX IF NOT EXISTS ps_next_run_idx
  ON probe_schedules (next_run_at ASC)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS ps_bu_idx
  ON probe_schedules (bu_id);

-- ─── Probe results ────────────────────────────────────────────────────────────
-- One row per criterion per probe run. Maps directly to AcceptanceCriteria.

CREATE TABLE IF NOT EXISTS probe_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id         UUID NOT NULL REFERENCES probe_schedules(id) ON DELETE CASCADE,
  bu_id               UUID NOT NULL REFERENCES behavioral_units(id) ON DELETE CASCADE,
  criterion_id        TEXT NOT NULL,                  -- AcceptanceCriterion.id
  criterion_given     TEXT NOT NULL,
  criterion_when      TEXT NOT NULL,
  criterion_then      TEXT NOT NULL,
  critical            BOOLEAN NOT NULL DEFAULT false,
  passed              BOOLEAN NOT NULL,
  response_status     INTEGER,                        -- HTTP status code
  response_body       TEXT,                           -- truncated to 2KB
  response_ms         INTEGER,                        -- latency
  failure_reason      TEXT,                           -- human-readable if failed
  probe_url           TEXT NOT NULL,
  probe_method        TEXT NOT NULL DEFAULT 'GET',
  probe_payload       JSONB,
  probed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_bu_probed_idx
  ON probe_results (bu_id, probed_at DESC);

CREATE INDEX IF NOT EXISTS pr_schedule_probed_idx
  ON probe_results (schedule_id, probed_at DESC);

CREATE INDEX IF NOT EXISTS pr_failed_idx
  ON probe_results (bu_id, probed_at DESC)
  WHERE passed = false;

-- ─── Trigger: updated_at on probe_schedules ────────────────────────────────

CREATE OR REPLACE TRIGGER probe_schedules_updated_at
  BEFORE UPDATE ON probe_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── View: production health per BU ───────────────────────────────────────────

CREATE OR REPLACE VIEW v_production_health AS
  SELECT DISTINCT ON (ps.bu_id)
    ps.bu_id,
    bu.claim,
    bu.domain,
    ps.id            AS schedule_id,
    ps.production_url,
    ps.interval_seconds,
    ps.consecutive_failures,
    ps.last_run_at,
    ps.next_run_at,
    ps.enabled,
    -- Latest run summary
    (
      SELECT COUNT(*) FROM probe_results pr
      WHERE pr.schedule_id = ps.id
        AND pr.probed_at > NOW() - INTERVAL '1 hour'
    )                AS probes_last_hour,
    (
      SELECT COUNT(*) FROM probe_results pr
      WHERE pr.schedule_id = ps.id
        AND pr.passed = false
        AND pr.probed_at > NOW() - INTERVAL '1 hour'
    )                AS failures_last_hour,
    -- Overall status
    CASE
      WHEN ps.consecutive_failures = 0 THEN 'healthy'
      WHEN ps.consecutive_failures < 3 THEN 'degraded'
      ELSE 'critical'
    END              AS health_status
  FROM probe_schedules ps
  JOIN behavioral_units bu ON bu.id = ps.bu_id
  WHERE ps.enabled = true
  ORDER BY ps.bu_id, ps.updated_at DESC;
