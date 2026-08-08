# Stella Fitness Requirements

## 1. Project Positioning

Stella Fitness is an OpenClaw Plugin providing a personal hypertrophy supervision agent.

The product goal is not to generate daily workouts. Users execute an established training program. The agent observes long-term progress and provides objective analysis.

## 2. Core Principles

### 2.1 Human execution

Training remains offline-first:

- Printed training plan
- Paper workout log
- Minimal interaction during exercise

### 2.2 Agent supervision

The agent receives:

- Training log photos
- Periodic body weight
- Optional diet records

The agent analyzes:

- Execution consistency
- Strength progression
- Weight trends
- Possible bottlenecks

## 3. Anti-sycophancy Requirement

The system must prevent user opinions from directly influencing diagnosis.

Required flow:

1. Extract objective evidence
2. Run blind assessment
3. Extract user belief separately
4. Audit diagnosis
5. Generate response

## 4. Initial Training Program

Source program: 卓叔增重 · 结构化增肌增重教程.

The program defines a 12-week cycle with three phases.

Known issue:

Week 4 Friday training data requires manual completion before becoming canonical program data.
