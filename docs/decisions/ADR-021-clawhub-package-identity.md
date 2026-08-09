# ADR-021 — ClawHub Package Identity

**Status:** Accepted  
**Date:** 2026-08-09

## Decision

The canonical ClawHub publication identity for Stella Fitness is:

```text
owner: tower1229
package: @tower1229/stella-fitness
source: tower1229/Stella-Fitness
```

The first release uses the individual `tower1229` owner. The project does not publish a second unscoped or alternate-owner package in parallel. If governance later moves to an organization, ownership is transferred through ClawHub's supported package-transfer process rather than creating a competing canonical identity.

The first release is manual/token-authenticated. Trusted publishing may be configured only after the initial package exists and the release workflow has been verified.

## Release validation

This decision freezes the intended identity but does not assert current registry authority or availability. Immediately before the first publish, the release operator must verify the authenticated account, owner access, package scope/name, source metadata, validation output, and dry-run. Failure must block publication; it must not trigger an unreviewed rename or owner change.

## Consequences

- manifests, package metadata, examples, and installation documentation use `@tower1229/stella-fitness` consistently;
- no ClawHub token or publishing workflow is added during Phase 0;
- rights, professional review, compatibility, package inspection, and security-review gates remain independent of namespace ownership.
