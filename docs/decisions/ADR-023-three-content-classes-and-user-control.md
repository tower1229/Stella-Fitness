# ADR-023 — Three Content Classes and User Control

**Status:** Accepted  
**Date:** 2026-08-09

## Decision

Stella Fitness uses three content classes for rights and control:

1. **Built-in Program content** — source material and derived program knowledge distributed by the project. The publisher must obtain and preserve authorization covering the actual artifact, modification, attribution, and channel.
2. **User Input Data** — training records, photos, body weight, profile/health information, statements, and other user-supplied artifacts. These are controlled by the user; the Plugin receives no reuse, publication, benchmark, or training right merely by processing them.
3. **User Derived Data** — Observation Records, Analysis Records, Training Progress, decisions, provenance, and other outputs about the user. These are stored in the Personal Data Directory and controlled by the user; the Plugin makes no ownership or secondary-use claim over them.

`Runtime Directory` is not a fourth rights class. It is a technical storage boundary for rebuildable state, indexes, locks, tasks, caches, and temporary sanitized media. It cannot become the canonical home of User Input Data or User Derived Data.

“User-controlled” is a product and data-governance commitment, not a warranty that the user owns every underlying copyright in material they upload. The user remains responsible for third-party rights in their inputs. Likewise, a user may manage local files freely, but public redistribution of embedded third-party content remains subject to the original rights.

Benchmarking is a secondary use, not a fourth class. Runtime data never enters a project benchmark automatically. The project may receive a separate copy only through an independent authorization that defines purpose, retention, public/private scope, de-identification, and withdrawal handling.

## Consequences

- Plugin functionality does not include telemetry or automatic benchmark contribution.
- Personal Data Directory artifacts are not licensed under the project Apache-2.0 license.
- Documentation distinguishes user control from a legal conclusion about third-party input ownership.
- Runtime implementation and model payloads cannot create an implicit project right to reuse personal data.
