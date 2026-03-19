-- Forge migration 005: multi-tenant workspaces
-- Adds workspace isolation so multiple teams can share one Forge instance.
-- Each workspace has its own intent graph, agents, and probe schedules.
-- API keys are scoped to a workspace.

-- ─── Workspaces ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,         -- e.g. "acme-backend", "my-team"
  name          TEXT NOT NULL,
  owner_email   TEXT,
  plan          TEXT NOT NULL DEFAULT 'solo', -- solo | team | enterprise
  settings      JSONB NOT NULL DEFAULT '{}',  -- feature flags, limits
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ws_slug_idx ON workspaces (slug);

-- Default workspace for existing single-tenant data
INSERT INTO workspaces (id, slug, name, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Default Workspace', 'solo')
ON CONFLICT (slug) DO NOTHING;

-- ─── API keys ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash        TEXT NOT NULL UNIQUE,    -- SHA-256 hash of the raw key
  key_prefix      TEXT NOT NULL,           -- first 8 chars for display: "fk_abc12..."
  name            TEXT NOT NULL DEFAULT 'Default key',
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ak_workspace_idx ON api_keys (workspace_id);
CREATE INDEX IF NOT EXISTS ak_hash_idx ON api_keys (key_hash);

-- ─── Add workspace_id to core tables ─────────────────────────────────────────
-- All existing rows go into the default workspace.

ALTER TABLE behavioral_units
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES workspaces(id) ON DELETE CASCADE
    DEFAULT '00000000-0000-0000-0000-000000000001';

UPDATE behavioral_units
  SET workspace_id = '00000000-0000-0000-0000-000000000001'
  WHERE workspace_id IS NULL;

ALTER TABLE probe_schedules
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES workspaces(id) ON DELETE CASCADE
    DEFAULT '00000000-0000-0000-0000-000000000001';

UPDATE probe_schedules
  SET workspace_id = '00000000-0000-0000-0000-000000000001'
  WHERE workspace_id IS NULL;

-- ─── Indexes for workspace-scoped queries ─────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS bu_workspace_domain_idx
  ON behavioral_units (workspace_id, domain, status)
  WHERE status != 'deprecated';

CREATE INDEX CONCURRENTLY IF NOT EXISTS ps_workspace_idx
  ON probe_schedules (workspace_id, enabled);

-- ─── Trigger: updated_at on workspaces ────────────────────────────────────────

CREATE OR REPLACE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
