# ASTER

ASTER is a Persona Contract Compiler for conversational AI systems. It validates versioned Persona Contracts and compiles published versions into deterministic, model-independent bundles with provenance.

## Current Scope

This v0.1 foundation includes:

- strict TypeScript domain/application boundaries;
- Persona Contract validation;
- draft persona and version creation;
- immutable publication of a persona version;
- deterministic compilation with a stable content hash;
- plugin reference validation that fails closed;
- tenant-scoped access, idempotency records, and append-only audit events;
- OpenAPI 3.1 and JSON Schema contract files;
- a public private-boundary guard for release hygiene.

Out of scope for this slice: chat UI, LLM inference, a plugin marketplace, and provider-specific prompt rendering.

## Repository Quality Gates

The default verification path is:

```bash
pnpm run check:private-boundary
pnpm run build
pnpm test
```

CI runs the same boundary, build, and test checks on pushes and pull requests.

## Quick Start

```bash
pnpm install
pnpm test
pnpm run check:private-boundary
```

Run the development HTTP server:

```bash
pnpm run build
node dist/apps/api/src/http.js
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

## API Shape

Protected endpoints require:

- `Authorization: Bearer <actor-id>`
- `X-Tenant-Id: <tenant-id>`
- `X-Correlation-Id: <optional correlation id>`
- `Idempotency-Key: <write idempotency key, where relevant>`

Primary flow:

1. `POST /v1/personas`
2. `POST /v1/personas/{personaId}/versions`
3. `POST /v1/personas/{personaId}/versions/{version}/publish`
4. `POST /v1/personas/{personaId}/versions/{version}/compile`

See `packages/contracts/openapi/openapi.yaml` and `packages/contracts/schemas/persona-contract.schema.json`.

## Local PostgreSQL

The first public slice includes a PostgreSQL compose service and SQL migration in `db/migrations/001_init.sql`. The in-process adapter is used for deterministic local tests; the migration describes the durable tables expected for the PostgreSQL adapter.

```bash
docker compose up postgres
```

## Security and Data Notes

- Tenant ID is treated as requested context, not authorization proof.
- Unknown plugin references block compilation.
- Published Persona Contract versions cannot be mutated.
- Audit events are append-only.
- Tests and fixtures use synthetic data only.
- Do not paste secrets, production conversation data, private prompts, or local operator material into issues, pull requests, fixtures, logs, or CI artifacts.

## Contributing and Security

- See `CONTRIBUTING.md` for development and pull request expectations.
- See `SECURITY.md` for vulnerability reporting and data-handling expectations.
- See `CODE_OF_CONDUCT.md` for participation standards.

## License

This repository is released under the Apache License 2.0. See `LICENSE`.
