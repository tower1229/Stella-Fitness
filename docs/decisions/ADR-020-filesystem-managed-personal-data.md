# ADR-020 — Filesystem-Managed Personal Data in V1

**Status:** Accepted  
**Date:** 2026-08-09

## Decision

Stella Fitness v1 does not provide general-purpose Plugin-level delete, export, backup, retention-policy, or recycle-bin features. The Runtime-located, user-controlled Personal Data Directory is itself the complete, portable data artifact and is managed with normal filesystem or Personal Data Repository tools.

The one narrow delete exception is part of the Program Journey recording workflow specified by Issues #22 and #27: when the user explicitly invalidates an active baseline or checkpoint BodyWeight Observation, the Plugin appends a canonical deletion record with provenance and rebuilds the journey and fact views. This does not expose arbitrary file deletion or a general data-maintenance surface; filesystem deletion remains the mechanism for all other user-managed data removal.

The Plugin must nevertheless honor filesystem changes as part of its data contract:

- missing raw artifacts are reported as `source_missing`; their structured Observation Records remain unless the user also removes those records;
- missing Observation Records cease to be active facts, and Training Record Views and runtime indexes are rebuilt without them;
- Runtime Directory caches or indexes never restore personal data removed from the Personal Data Directory;
- schema-invalid manual edits are reported and excluded from active computation, not silently overwritten or repaired;
- deleting or moving the located directory fails closed until the Runtime-owned locator resolves a valid Personal Data Directory.

Copying the directory is the v1 export mechanism. Backup history, Git history, remote copies, secure erasure, and recovery are responsibilities of the user's chosen filesystem/repository tooling, not claims made by the Plugin.

## Consequences

- v1 has no parallel general-purpose data-maintenance UI or command surface; the Program Journey may expose only its provenance-preserving BodyWeight Observation invalidation command.
- The on-disk layout, schema versions, relative references, and validation errors must be documented and human-navigable.
- Acceptance tests exercise external file deletion/editing followed by rescan and deterministic rebuild.
- User correction through the core extraction workflow remains supported; it is distinct from general-purpose data maintenance.
