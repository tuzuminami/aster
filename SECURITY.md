# Security Policy

## Supported Versions

ASTER v1.x receives security fixes for the latest supported v1 release. Security fixes also
target the default branch while the next release is in development.

## Reporting a Vulnerability

Do not open a public issue for suspected vulnerabilities, secrets, private prompts, production conversation data, or tenant data. Use this repository's enabled GitHub private vulnerability reporting path instead.

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
