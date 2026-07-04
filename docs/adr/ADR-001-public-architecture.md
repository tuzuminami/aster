# ADR-001: Public Architecture

## Status

Accepted

## Context

ASTER compiles versioned Persona Contracts into deterministic bundles that can be consumed by model adapters, applications, or scenario systems. The public repository needs a small, verifiable foundation before adding broader API surface or UI.

## Decision

The repository uses a strict TypeScript core with transport, domain, and adapter boundaries. The first slice validates a Persona Contract, persists a draft version, publishes it immutably, and compiles it into a deterministic bundle with provenance and audit evidence.

## Consequences

- Published versions are immutable.
- Compilation hashes are stable for the same contract and compiler version.
- Unknown plugin references fail closed.
- Public docs describe only released behavior and operating constraints.
