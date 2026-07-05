# ASTER

ASTER is a Persona Contract Compiler for conversational AI systems. It validates versioned Persona Contracts and compiles published versions into deterministic, model-independent bundles with provenance.

## Current Scope

This v0.2 foundation includes:

- strict TypeScript domain/application boundaries;
- Persona Contract validation;
- draft persona and version creation;
- immutable publication of a persona version;
- deterministic compilation with a stable content hash;
- plugin reference validation that fails closed;
- tenant-scoped access, idempotency records, and append-only audit events;
- OpenAPI 3.1 and JSON Schema contract files;
- a public private-boundary guard for release hygiene;
- a PostgreSQL adapter, migrations, and CI-backed PostgreSQL integration coverage.

Out of scope for this slice: chat UI, LLM inference, a plugin marketplace, and provider-specific prompt rendering.

## Repository Quality Gates

The default verification path is:

```bash
pnpm run check:private-boundary
pnpm run build
pnpm test
pnpm run test:compiled
pnpm pack --dry-run
```

CI runs the same boundary, build, and test checks on pushes and pull requests.

## Quick Start

```bash
pnpm install
pnpm test
pnpm run check:private-boundary
```

The repository includes a synthetic Persona Contract fixture at `examples/persona-contract.json`.

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
- `Idempotency-Key: <required for state-changing operations>`

Primary flow:

1. `POST /v1/personas`
2. `POST /v1/personas/{personaId}/versions`
3. `POST /v1/personas/{personaId}/versions/{version}/publish`
4. `POST /v1/personas/{personaId}/versions/{version}/compile`
5. `GET /v1/personas/{personaId}/versions/{version}/diff/{otherVersion}`

See `packages/contracts/openapi/openapi.yaml` and `packages/contracts/schemas/persona-contract.schema.json`.

## Local PostgreSQL

ASTER can run with the in-process adapter for deterministic development tests, or with PostgreSQL by setting `DATABASE_URL`.

```bash
docker compose up postgres
export DATABASE_URL=postgres://aster:aster_dev_password@127.0.0.1:5432/aster
pnpm run db:migrate
DATABASE_URL=$DATABASE_URL node apps/api/src/http.ts
```

Run the PostgreSQL integration test:

```bash
TEST_DATABASE_URL=postgres://aster:aster_dev_password@127.0.0.1:5432/aster pnpm run test:postgres
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
