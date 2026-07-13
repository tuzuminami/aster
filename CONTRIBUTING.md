# Contributing

Thanks for improving ASTER.

## Development

```bash
pnpm install
pnpm run check:private-boundary
pnpm run build
pnpm test
```

## Pull Request Checklist

- Keep domain logic independent from HTTP, database clients, provider SDKs, and `process.env`.
- Validate untrusted input at the transport or adapter boundary.
- Preserve tenant isolation in every read and write path.
- Add or update tests for success, invalid input, authorization/tenant failure, idempotency, audit, and fail-closed behavior when relevant.
- Do not include secrets, production data, private prompts, local evidence, private planning files, or machine-specific paths.
- Run the private-boundary guard before opening the PR.
- Complete the pull-request template, including compatibility, safety, operational, and verification evidence.
- Follow the protected-branch and release expectations in `docs/RELEASE_GOVERNANCE.md`.

## Dependency Policy

Avoid adding dependencies unless they materially reduce risk or complexity. Do not add GPL or AGPL dependencies to the core runtime path.
