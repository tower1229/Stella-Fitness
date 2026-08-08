# Training Log Workbook Source Audit

**artifact:** original-course three-stage XLSX workout log  
**received:** 2026-08-08  
**provenance:** confirmed by user as original-course companion material from the original author or another reliable same-source version  
**prescription authority:** accepted for source-plan reconciliation  
**public GitHub repository inclusion:** explicitly approved by user on 2026-08-08  
**ClawHub/npm/package bundling:** separate release decision, not implied by repository inclusion

## Repository artifact

Canonical raw archive path:

```text
sources/originals/zhuoshu-workout-log.xlsx
```

Audited artifact identity:

```text
size: 20,964 bytes
sha256: A113A16F9844CEB518307369BD45979AF3AA703E67DA8EB3BBB6B5E991AEBCCA
```

The raw XLSX is retained as the immutable source artifact; requirements and `knowledge/` documents are derived layers.

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

The first-stage sheet contains the authoritative block at `第一阶段!A81:J85`:

```text
第4周，周五，力量测试
```

with fields for:

- goblet squat 12RM test weight;
- dumbbell bench press 12RM test weight;
- dumbbell deadlift 12RM test weight;
- pull-up first-set maximum repetitions.

The user explicitly confirmed that this strength test is part of the original training plan.

Canonical source meaning:

```text
Week 4 Friday = strength test
main three lifts = 12RM test
pull-up = first-set maximum reps test
```

## Confirmed interpretation relationships

The user subsequently confirmed:

- initial `A` = each main lift's own initial 12RM;
- Week 4 12RM results directly become the corresponding Phase 2 `N` values;
- the pull-up test informs assistance-band choice, aiming for at least about 8 reps per set while preserving the programmed total-reps target;
- Week 4 uses the same 12RM testing protocol as the end-of-cycle retest;
- `哑铃推举` and `哑铃推肩` are the same exercise, normalized to `哑铃推肩 / dumbbell-overhead-press`;
- third-month `哑铃弯举 / dumbbell-curl` is a separate exercise;
- detailed Phase 1 weekly prescriptions override the long-term “two-week loading frequency” summary.

These interpretations are recorded in `knowledge/programs/zhuoshu-12-week/open-questions.md` as an audit trail and encoded in `program-spec.v0.2.yaml`.

## Other interpretation notes

- Week 8 and Week 12 recovery sessions use the same generic logging layout as normal sessions; recovery semantics come from the source program / ProgramSpec, not heading style alone.
- `重量` is polymorphic: kg for dumbbells, assistance description for pull-ups, and posture/load descriptions for push-ups.
- set columns may represent repetitions or duration depending on the exercise.

## Rights handling

The user has explicitly approved committing this raw XLSX to the public `tower1229/Stella-Fitness` GitHub repository.

This approval resolves **repository archival** only. Before a future ClawHub/npm/package release, decide separately whether the raw XLSX itself is bundled in the distributable artifact or whether only derived/open project files are distributed.
