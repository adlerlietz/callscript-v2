# CallScript V2 – Security & Hygiene

## 1. Secret Detection

NEVER commit secrets.

Scan for these patterns:

- Ringba tokens: `RW[a-zA-Z0-9]{20,}`
- OpenAI keys: `sk-[a-zA-Z0-9]{48}`
- Supabase keys: `eyJ[a-zA-Z0-9._-]{20,}`
- RunPod key: `rpa_[a-zA-Z0-9]{20,}`
- Postgres URI: `postgres://[^\s]+`

All secrets must be in `.env` and `.gitignore`.

---

## 2. Dependency Safety

- Must check maintenance status before adding a package.
- Must commit lockfiles.
- Avoid low-quality or duplicate dependencies.

---

## 3. Data Hygiene

- No real PII in tests or documentation.
- Avoid logging:
  - raw transcripts
  - phone numbers
  - audio URLs

---

## 4. Access Control

- Never expose Supabase service_role key to frontend.
- RLS must be ON for all `core` tables.

