# CallScript V2 – Testing Strategy

Philosophy: **Test Logic, Not Implementation.**

---

## 1. TEST LANES

### 1.1 Frontend (Next.js / React)

- Test:
  - Flags Queue
  - Player component
  - Dashboard metrics
- Must handle:
  - loading
  - empty
  - error
- Run: `npm test`

---

### 1.2 Ingestion Tests

Mock Ringba API:

- Test pagination (returns fewer results)
- Test idempotent upserts
- Test handling of `0 results`
- Test API error → graceful exit

---

### 1.3 Worker Tests (Python)

**Happy path:**

1 row → mock audio → run worker → assert `status = completed`.

**LIFO:**

Insert:

- Old Row
- New Row

Worker MUST process the newer row first.

**Failure path:**

- Force GPU error → retry_count increments → eventually `failed`.

---

## 2. 3-STEP FIX PROTOCOL

1. **Reproduce:** create a failing test
2. **Fix:** write code until test passes
3. **Regression:** run full suite

---

## 3. CI REQUIREMENTS

Lint → Type Check → Tests → Build

All must pass before merging.

