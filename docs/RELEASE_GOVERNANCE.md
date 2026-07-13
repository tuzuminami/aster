# Release Governance

ASTER is independently versioned and released. This document records the minimum
GitHub configuration expected for changes to the default branch and published releases.

## Ownership and Review

- `CODEOWNERS` assigns the repository, contracts, migrations, workflows, security policy,
  and release metadata to the maintainer.
- Pull requests use the repository template to record compatibility, safety, operational,
  documentation, and verification evidence.
- Security vulnerabilities, secrets, production data, and tenant data use the private path
  in `SECURITY.md`, not public issues or pull requests.

## Default-Branch Protection

Configure an active repository ruleset named `main-pr-ci` for `refs/heads/main`:

- require a pull request before merge, with all review conversations resolved;
- require the GitHub Actions check named `verify` to pass against the latest
  target branch commit;
- block non-fast-forward updates and branch deletion;
- apply no bypass actor during normal solo-maintainer operation.

ASTER is currently maintained by one account. Do not require approving reviews or
CODEOWNERS reviews while that remains true: GitHub does not allow an author to approve
their own pull request, so those settings would block every maintainer change. The
maintainer records the review rationale in the pull request and requires green `verify` CI.
For a genuine incident, the owner may use an explicitly audited ruleset bypass only;
the recovery must be followed by a pull request that restores the protected state.

After a second write-capable maintainer is added, enable these additional protections:

- require one approving review and dismiss stale approvals when new commits are pushed;
- require review of CODEOWNERS-owned paths;
- require the same `CI / verify` status check before merge.

## Release Protection

- Create releases from an annotated semantic-version tag after the protected default branch
  is green. This rule applies to releases created on or after 2026-07-13;
  the existing lightweight `v1.0.0` tag is a historical exception and is not rewritten.
- Configure an active `release-tags` ruleset for `refs/tags/v*` that blocks tag
  updates and deletion. Only create a tag from the verified merge commit.
- Run `pnpm run verify` and inspect `pnpm pack --dry-run` before creating a tag.
- Document compatibility, migration, rollback, and known operational limitations in release notes.
- Keep release automation and provenance implementation in the supply-chain release work;
  this governance baseline does not publish artifacts automatically.

## Maintainer Evidence

For every release created on or after 2026-07-13, retain the pull request, green CI run URL, review record, tag, release notes,
and package file list plus SHA-256 evidence in the public repository history. The earlier `v0.1.0` and
`v1.0.0` releases predate this evidence policy and remain historical exceptions. Do not attach private logs,
secrets, customer data, or internal planning material.
