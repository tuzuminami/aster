# Security Policy

## Supported Versions

ASTER is pre-1.0. Security fixes target the default branch until tagged releases begin.

## Reporting a Vulnerability

Do not open a public issue for suspected vulnerabilities, secrets, private prompts, production conversation data, or tenant data.

Send a private report to the repository owner with:

- affected version or commit;
- reproduction steps;
- expected impact;
- whether credentials, private data, or tenant boundaries may be involved.

## Security Expectations

- Unknown authorization, tenant scope, plugin capability, or configuration state fails closed.
- Public tests and fixtures must use synthetic data only.
- Raw secrets and production personal data must not appear in logs, issues, fixtures, or CI artifacts.
- Every public contribution should pass `pnpm run check:private-boundary` before review.
