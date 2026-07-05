CREATE TABLE plugin_manifests (
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  core_api_version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, name, version)
);
