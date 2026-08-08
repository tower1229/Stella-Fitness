# Stella Fitness

> An OpenClaw plugin for objective, long-term hypertrophy supervision.

Stella Fitness is not an AI personal trainer that continuously tells you what to do during a workout. Users keep training normally with a stable program and low-friction paper logs; the agent observes long-term evidence, detects meaningful deviations, and intervenes only when necessary.

```text
Human executes.
Agent observes.
Evidence decides.
```

## Product Direction

Stella Fitness is designed around four constraints:

1. **Offline-first training** — no requirement to type into a phone between sets.
2. **Low-friction data capture** — photograph paper workout logs after training; enter body weight periodically; diet records are optional.
3. **Evidence-first supervision** — deterministic program/metrics engines establish facts before models interpret them.
4. **Anti-sycophancy by architecture** — user beliefs are withheld from blind diagnosis and introduced only during an independent audit stage.

## Current Status

**Phase 0 — Foundation**

- [x] Product requirements frozen
- [x] Architecture direction established
- [x] 12-week source program reorganized into Markdown
- [x] ProgramSpec v0.1 drafted
- [x] Known source gaps explicitly tracked
- [ ] OpenClaw plugin skeleton
- [ ] ProgramSpec validator and fixtures
- [ ] Data ingestion pipeline
- [ ] Supervision pipeline
- [ ] ClawHub release

The source material explicitly lacks the Week 4 Friday workout. Stella Fitness keeps that session `unresolved` rather than generating a plausible replacement.

## Documentation

### Project

- [Frozen requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [ProgramSpec v0.1 design](docs/program-spec.md)
- [Known gaps](docs/known-gaps.md)
- [Documentation system](docs/document-system.md)
- [Implementation roadmap](docs/roadmap.md)

### Training Knowledge

- [Knowledge index](knowledge/README.md)
- [卓叔 12 周结构化增肌增重计划](knowledge/programs/zhuoshu-12-week/README.md)
- [ProgramSpec v0.1 YAML](knowledge/programs/zhuoshu-12-week/program-spec.v0.1.yaml)

## Architecture Principle

The planned runtime separates responsibilities:

```text
Program Engine + Metrics Engine
            ↓
       EvidencePacket
            ↓
     Blind Diagnosis
            ↓
User Belief → Adversarial Audit
            ↓
    Deterministic Policy Gate
            ↓
        User response
```

The conversational model must not be the authority that decides what evidence exists.

## Release Target

The project is intended to be implemented as an independently installable **OpenClaw Plugin** and published through **ClawHub**, with installation, provider configuration, privacy, backup, evaluation, and known-limitations documentation.

## Development Branch

Current foundation work is being prepared on:

```text
agent/initialize-stella-fitness
```

See [roadmap](docs/roadmap.md) for the next implementation milestone.
