# Document System

## Repository Structure

```
.
├── src/
│   ├── plugin/
│   ├── agents/
│   ├── engine/
│   └── storage/
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   ├── document-system.md
│   └── roadmap.md
├── knowledge/
│   ├── programs/
│   ├── exercises/
│   └── nutrition/
└── tests/
```

## Knowledge Layer

Training knowledge is separated from runtime logic.

- programs: canonical training plans
- exercises: movement knowledge
- nutrition: diet guidance

## Runtime Data

User execution data should not be stored in knowledge files.

Runtime data belongs to plugin-managed storage.
