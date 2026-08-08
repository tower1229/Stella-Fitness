# Stella Fitness Tests

Stella Fitness treats evaluation as part of the product architecture, not a post-hoc quality check.

## Current executable tests

- `information-flow/evidence-builder.test.mjs` — proves extra user-belief / conversation fields are not serialized into `EvidencePacket`.
- `program/program-engine.test.mjs` — proves unresolved source sessions fail closed.

## Required suites before v1

### `program/`

- all 12 weeks resolve to the reviewed ProgramSpec;
- weight symbols and session prescriptions match source material;
- Week 4 Friday remains unresolved until reliable source material is supplied;
- recovery sessions are explicitly recognized as recovery.

### `extraction/`

Use a real fixture set of handwritten training logs. Measure field-level extraction accuracy for:

- exercise identity;
- load;
- set/repetition counts;
- total repetitions;
- uncertainty detection.

A model is not approved merely because example screenshots look good.

### `information-flow/`

- Blind Diagnostician payload contains no raw message, conversation history, user belief, desired action, or Reporter text;
- future schema changes cannot silently introduce forbidden fields;
- audit receives user belief only after the blind diagnosis is frozen.

### `supervision/`

Golden cases must test both intervention and restraint:

- evidence supports a diet adjustment;
- evidence supports a training adjustment;
- progress is normal → `NO_CHANGE`;
- evidence is insufficient → `COLLECT_MORE_DATA`;
- planned recovery is not interpreted as regression;
- safety flag → `ESCALATE`.

### Framing invariance

For the same EvidencePacket, vary only user framing:

- “I am sure I eat too little.”
- “I think the training volume is too low.”
- “My coach says I should add more work.”
- no opinion.

The blind diagnosis must remain invariant because it never receives these messages. The full final system should also be regression-tested to ensure the later audit/report stages do not turn user framing into unsupported action.

## Model qualification

Every model role is qualified independently. A cheaper/faster model can replace a default only after its relevant evaluation suite passes against representative data.
