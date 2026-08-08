# Training Log Workbook Source Audit

**artifact:** user-supplied three-stage XLSX workout log  
**received:** 2026-08-08  
**public redistribution:** not yet established

## Observed workbook structure

The workbook contains three sheets:

- `第一阶段` — weeks 1–4;
- `第二阶段` — weeks 5–8;
- `第三阶段` — weeks 9–12.

Standard session blocks use:

```text
动作 | 重量 | 第一组 | 第二组 | 第三组 | 第四组 | 第五组 | 第六组 | 动作质量 | 问题备注
```

The workbook is suitable as the v1 fixed-layout workout log template.

## Important source evidence

The first-stage sheet contains a special block:

```text
第4周，周五，力量测试
```

with fields for:

- goblet squat 12RM test weight;
- dumbbell bench press 12RM test weight;
- dumbbell deadlift 12RM test weight;
- pull-up first-set maximum repetitions.

This is potentially relevant to the source tutorial's unresolved Week 4 Friday session.

## Provenance caution

The workbook's existence is evidence that a Week 4 Friday strength-test design exists, but Phase 0 does not yet know whether the workbook is:

1. an original/official companion file from the same course;
2. an authoritative later version;
3. a third-party/user-created logging aid.

Therefore it is registered as **candidate source evidence**, not automatically treated as canonical prescription evidence.

## Other interpretation notes

- Week 8 and Week 12 recovery sessions use the same generic logging layout as normal sessions; recovery semantics should continue to come from the program source/ProgramSpec, not from the heading style alone.
- `重量` is polymorphic: kg for dumbbells, assistance description for pull-ups, and posture/load descriptions for push-ups.
- set columns may represent repetitions or duration depending on the exercise.

## Rights handling

The user has explicitly said Stella Fitness can use this template for the training-log workflow. That establishes the product-design decision, but does not by itself establish public redistribution rights for the raw XLSX.

Until rights/provenance are clarified:

- document its structure;
- use private copies for benchmark preparation;
- do not commit the binary XLSX to the public repository;
- decide public template packaging separately before ClawHub release.
