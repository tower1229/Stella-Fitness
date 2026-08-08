# Changelog

All notable changes to Stella Fitness will be documented here.

The project is currently pre-release. Version numbers before the first public release describe repository/package evolution and do not imply a production-ready fitness supervision system.

## Unreleased

### Added

- Frozen product requirements for an offline-first, low-friction hypertrophy supervisor.
- OpenClaw Native Plugin architecture with explicit conversation interception and isolated model-call boundaries.
- Anti-sycophancy data flow: EvidencePacket → Blind Diagnosis → Belief Extraction → Adversarial Audit → deterministic Policy Gate → restricted Reporter.
- Markdown restructuring of the supplied 12-week training source.
- Draft `ProgramSpec v0.1` with source gaps represented explicitly.
- OpenClaw plugin/package/TypeScript scaffolding.
- Plugin-owned SQLite domain schema using Node built-in `node:sqlite`.
- Domain contracts for program, evidence, diagnosis, audit, and decisions.
- Ingress contracts for workout-log photos, diet estimates, and body weight.
- Initial executable Information Flow and unresolved-source tests.
- GitHub Actions CI across Node 22.22.3 and 24.15.0.
- Development, installation, model strategy, source governance, and release-blocker documentation.

### Known limitations

- The plugin hooks are intentionally pass-through; the supervision pipeline is not active.
- Week 4 Friday is unresolved in the supplied program source.
- The source tutorial redistribution license is unknown.
- Project software license is not yet selected.
- ClawHub namespace/package scope is provisional.
- Intervention thresholds and safety policy are not yet approved for production use.
