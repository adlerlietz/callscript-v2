# CallScript V2 – CLAUDE Control Plane

Follow these rules at all times:

- @docs/RULES.md (Project Rules)
- @docs/SECURITY.md (Security)
- @docs/TESTING.md (Testing Standards)

Architecture Source of Truth:

- @docs/MASTER_BIBLE.md

Memory Bank:

- Active task: @docs/memory/scratchpad.md
- Long-term lessons: @docs/memory/lessons.md

---

## Project Context

Mission: Build the automated Pay-Per-Call QA Factory (Ingest → Vault → Factory → Judge).

Stack:

- Frontend: Next.js 15, React, TypeScript, Shadcn/UI
- API: Supabase Edge Functions (TypeScript)
- Workers: Python + RunPod (RTX 3090) for transcription/diarization
- Database: Postgres (Supabase), schema = `core`

Critical Invariants:

- **LIFO is Law:** Workers must always use `ORDER BY start_time_utc DESC`
- **Audio First:** No processing until audio is secured (`storage_path IS NOT NULL`)
- **4-Lane Architecture:** Ingest → Vault → Factory → Judge
- **Idempotent ingestion:** Must be re-runnable without duplicates

---

## Operational Directives

### 1. Plan First

For any non-trivial change (>5 lines of code or affecting multiple files):

- Write a step-by-step plan in @docs/memory/scratchpad.md before coding.

### 2. Progressive Disclosure

Claude must load only the relevant rules:

- **Frontend work (Next.js / UI) →** read:
  - @docs/RULES.md (Frontend section)
  - @docs/TESTING.md (Frontend Tests)

- **API / Edge Functions →** read:
  - @docs/RULES.md (Backend section)
  - @docs/MASTER_BIBLE.md (Data Flow)

- **Python Worker / GPU Lane →** read:
  - @docs/RULES.md (Workers section)
  - @docs/TESTING.md (Worker Lanes)

- **Security-sensitive changes →** read:
  - @docs/SECURITY.md

### 3. No Fluff

Outputs must contain:

- Code
- Short explanations

No conversational filler.

---

## Core Commands

### Frontend

```bash
npm run dev
npm test
npm run lint:fix
npm run build
```

### Workers

```bash
python workers/main.py   # With venv active
```

