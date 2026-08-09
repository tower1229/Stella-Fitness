# ADR-018 — Apache-2.0 Code License with Separate Content Rights

**Status:** Accepted  
**Date:** 2026-08-09

## Decision

Stella Fitness Plugin source code, generic schemas, and project-authored materials not derived from the Zhuoshu course are licensed under Apache License 2.0. The repository and distributable must include the standard `LICENSE` and a `NOTICE` that makes the scope boundary explicit.

The following do not receive an Apache-2.0 grant from this project:

- raw DOCX/XLSX source artifacts under `sources/originals/`;
- the Zhuoshu-derived Built-in Program, ProgramSpec, and related structured knowledge, until a separate written authorization and rights notice covers the relevant artifact, modification, attribution, and distribution channel;
- contents of a user's Personal Data Directory.

The software license decision therefore closes the code-license gap but does not close the Built-in Program authorization gate.

## Consequences

- Every source and release package containing Apache-licensed work includes `LICENSE` and `NOTICE`.
- Package inspection verifies both the notices and the exclusion of raw Office artifacts.
- The Built-in Program cannot be released merely because it is stored beside Apache-licensed code.
- Personal data remains controlled by the user and is never treated as a project contribution or licensed project artifact merely because the Plugin processed it.
