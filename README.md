# ASTER
<p align="center">
  <img src="./docs/brand/banner.svg" width="100%" alt="ASTER — Persona Contract Compiler" />
</p>

<p align="center"><strong>Part of the Tuzuminami AI Systems reference architecture.</strong><br />Independent packages, designed to compose — without claiming runtime package dependencies.</p>

> **System role:** Make every persona versionable, portable, and provable. ASTER compiles published Persona Contracts into deterministic bundles.

## Ecosystem reference architecture

The map below describes an **intended composition**, not current npm/package dependencies. Every repository remains independently usable and independently versioned. An application verifies a VEIL decision before it invokes RELAY; this does not indicate direct VEIL-to-RELAY SDK integration.

```mermaid
flowchart LR
  ASTER["ASTER<br/>Persona contracts"] -->|"compiled artifact reference"| DRIFT["DRIFT<br/>Scenarios & replay"]
  MORROW["MORROW<br/>Consent-aware memory"] --> APP["AI application"]
  TETHER["TETHER<br/>Relationship state"] --> APP
  APP -->|"action context"| VEIL["VEIL<br/>Policy decision"]
  APP -->|"model request after decision verification"| RELAY["RELAY<br/>Inference gateway"]
  RELAY --> PROVIDER["Model / tool provider"]
  PULSE["PULSE<br/>Evaluation harness"] -. "evaluates HTTP targets" .-> APP
  PULSE -.-> VEIL
  PULSE -.-> RELAY
  classDef policy fill:#1D2645,stroke:#6FF6C8,color:#FFFFFF
  classDef relationship fill:#3C144C,stroke:#E82973,color:#FFFFFF
  classDef gateway fill:#113A48,stroke:#31D2C9,color:#FFFFFF
  classDef eval fill:#3F215A,stroke:#E8A1FF,color:#FFFFFF
  classDef memory fill:#3D3A20,stroke:#EFD576,color:#FFFFFF
  classDef orchestration fill:#1D3942,stroke:#6DD9DF,color:#FFFFFF
  classDef persona fill:#3B1E14,stroke:#FFC79F,color:#FFFFFF
  class VEIL policy
  class TETHER relationship
  class RELAY gateway
  class PULSE eval
  class MORROW memory
  class DRIFT orchestration
  class ASTER persona
```

| System | What it contributes |
| --- | --- |
| [VEIL](https://github.com/tuzuminami/veil) | Fail-closed policy decisions and receipts before agent actions. |
| [TETHER](https://github.com/tuzuminami/tether) | Explicit, explainable relationship state. |
| [RELAY](https://github.com/tuzuminami/relay) | Tenant-aware inference routing and provider enforcement. |
| [PULSE](https://github.com/tuzuminami/pulse) | Regression evaluation for HTTP targets and release evidence. |
| [MORROW](https://github.com/tuzuminami/morrow) | Consent, purpose, retention, and revocation-aware memory. |
| [DRIFT](https://github.com/tuzuminami/drift) | Deterministic scenario/session orchestration and replay. |
| [ASTER](https://github.com/tuzuminami/aster) | Versioned persona contracts compiled into portable artifacts. |



ASTER is a Persona Contract Compiler for conversational AI systems. It validates versioned Persona Contracts and compiles published versions into deterministic, model-independent bundles with provenance.

## v1 Scope

ASTER v1.0.0 established the first stable public release of the Persona Contract Compiler. The v1 series includes:

- strict TypeScript domain/application boundaries;
- Persona Contract validation;
- draft persona and version creation;
- immutable publication of a persona version;
- deterministic compilation with a stable content hash;
- plugin reference validation that fails closed;
- tenant-scoped access, request-bound idempotency records, and append-only audit events;
- OpenAPI 3.1 and JSON Schema contract files;
- a public private-boundary guard for release hygiene;
- a PostgreSQL adapter, migrations, and CI-backed PostgreSQL integration coverage.

Out of scope for v1.0.0: chat UI, LLM inference, a plugin marketplace, and provider-specific prompt rendering.

## Compatibility and Composition

ASTER follows semantic versioning for its published package API and Persona Contract schema. A v1.x consumer can rely on the exported compiler API and published contract files; incompatible changes require a new major release and a documented migration path.

Compiled persona bundles are self-contained artifacts. They can be used by an application on their own, or referenced by [DRIFT](https://github.com/tuzuminami/drift) for scenario and replay workflows. That reference is an optional transport-level composition, not an ASTER-to-DRIFT runtime package dependency. Each project can be upgraded, deployed, and evaluated independently.

## Repository Quality Gates

The default verification path is:

```bash
pnpm run check:private-boundary
pnpm run build
pnpm test
pnpm run test:compiled
pnpm pack --dry-run
pnpm run check:release-docs
```

CI runs the same boundary, build, test, package, and release-documentation checks on pushes and pull requests.

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

Protected endpoints require an application-provided OIDC/JWT-verifying authentication adapter.
The adapter derives actor ID, tenant ID, and operation scopes from a verified principal; a bearer
string alone is never authorization proof. `X-Tenant-Id` is optional and, when supplied, must match
the verified tenant. Production startup requires a verified auth adapter and explicit durable-storage
assertion, and rejects the development adapter and a wildcard network binding.

- `Authorization: Bearer <verified token>`
- `X-Tenant-Id: <optional consistency check>`
- `X-Correlation-Id: <optional correlation id>`
- `Idempotency-Key: <required for state-changing operations>`

An idempotency key is bound to the authenticated actor and canonical request input. Retrying the same request is stable; reusing a key for a different payload or resource returns `409 IDEMPOTENCY_CONFLICT`.

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

- Tenant ID and actor ID are derived from a verified principal, not request headers.
- Unknown plugin references block compilation.
- Published Persona Contract versions cannot be mutated.
- Audit events are append-only.
- Tests and fixtures use synthetic data only.
- Do not paste secrets, production conversation data, private prompts, or local operator material into issues, pull requests, fixtures, logs, or CI artifacts.

## Contributing and Security

- See `CONTRIBUTING.md` for development and pull request expectations.
- See `SECURITY.md` for vulnerability reporting and data-handling expectations.
- See `docs/RELEASE_GOVERNANCE.md` for ownership, review, branch protection, and release expectations.
- See `CODE_OF_CONDUCT.md` for participation standards.

## License

This repository is released under the Apache License 2.0. See `LICENSE`.
