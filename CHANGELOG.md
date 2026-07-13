# Changelog

## Unreleased

- Align the public OpenAPI tenant assertion and plugin-validation request contract with the executable HTTP runtime.

## 1.0.0 - 2026-07-13

- Finalized ASTER as the portable Persona Contract Compiler support module.
- Added deterministic compile/version behavior, tenant-scoped PostgreSQL storage,
  idempotency, HTTP contract coverage, and public package boundary verification.

## 0.2.0 - 2026-07-05

- Added the PostgreSQL adapter for personas, versions, compiled bundles, idempotency records, plugin manifests, and audit events.
- Added migration runner and a second migration for plugin manifests.
- Added optional PostgreSQL integration coverage and GitHub Actions PostgreSQL service verification.
- Tightened package release contents for compiled runtime, contracts, migrations, and license files.

## 0.1.0 - 2026-07-05

- Added the initial Persona Contract validation and deterministic compilation foundation.
- Added tenant-scoped service ports, idempotency handling, plugin fail-closed validation, and append-only audit events.
- Added OpenAPI, JSON Schema, PostgreSQL migration, public boundary guard, and OSS hygiene files.
- Replaced the placeholder license with a standard Apache License 2.0 file.
