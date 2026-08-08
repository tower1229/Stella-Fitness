# Training Log Workbook Source Audit

**artifact:** user-supplied three-stage XLSX workout log  
**received:** 2026-08-08  
**provenance:** confirmed by user as original-course companion material from the original author or another reliable same-source version  
**prescription authority:** accepted for source-plan reconciliation  
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

The workbook is adopted as the v1 fixed-layout workout log template.

## Authoritative Week 4 Friday evidence

The first-stage sheet contains:

```text
第4周，周五，力量测试
```

with fields for:

- goblet squat 12RM test weight;
- dumbbell bench press 12RM test weight;
- dumbbell deadlift 12RM test weight;
- pull-up first-set maximum repetitions.

The user explicitly confirmed that this workbook is original-course companion material and that this strength test is part of the training plan.

Therefore the previous “Week 4 Friday source missing” interpretation is closed.

Canonical source meaning is now:

```text
Week 4 Friday = strength test
main three lifts = 12RM test
pull-up = first-set maximum reps test
```

## Remaining interpretation questions

The workbook establishes **what happens**, but does not by itself make every relationship explicit.

Still awaiting source/user clarification:

- whether the three 12RM test results directly define Week 5 `N`;
- whether the pull-up max-reps result is baseline-only or affects Phase 2 targets;
- whether this test uses the same 12RM protocol described at the end of the 12-week cycle;
- the precise initial-cycle definition of `A`;
- naming equivalence of `哑铃推举` / `哑铃推肩`;
- the Phase 1 “two-week loading frequency” summary conflict.

These are tracked in `knowledge/programs/zhuoshu-12-week/open-questions.md` and must not be guessed.

## Other interpretation notes

- Week 8 and Week 12 recovery sessions use the same generic logging layout as normal sessions; recovery semantics continue to come from the program source/ProgramSpec, not heading style alone.
- `重量` is polymorphic: kg for dumbbells, assistance description for pull-ups, and posture/load descriptions for push-ups.
- set columns may represent repetitions or duration depending on the exercise.

## Rights handling

The user has approved using this workbook as the Stella Fitness training-log workflow and confirmed its same-source reliability.

That confirms **product use and source-plan interpretation**, but does not by itself establish public redistribution rights for the raw XLSX binary.

Until redistribution rights are separately confirmed:

- document and use its structure in requirements;
- use private copies for benchmark preparation;
- do not commit the binary XLSX to the public repository;
- decide public template packaging separately before ClawHub release.
