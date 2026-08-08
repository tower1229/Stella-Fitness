# Stella Fitness Architecture

## Overview

```
OpenClaw Agent
      |
      v
Stella Fitness Plugin
      |
      +-- Data ingestion
      +-- Program engine
      +-- Metrics engine
      +-- Blind diagnosis
      +-- Audit
      +-- Policy gate
      +-- Response generation
```

## Information Isolation

The plugin must not allow the conversational model to directly reason from user assumptions.

Separate contexts:

- Evidence context
- User belief context
- Audit context

## Components

### Program Engine

Deterministic interpretation of training plans.

### Metrics Engine

Calculates:

- Weight trends
- Training completion
- Strength progression

### Blind Diagnosis

Analyzes evidence without user expectations.

### Policy Gate

Controls whether recommendations are allowed.

Possible outcomes:

- NO_CHANGE
- OBSERVE
- COLLECT_MORE_DATA
- ADJUST
