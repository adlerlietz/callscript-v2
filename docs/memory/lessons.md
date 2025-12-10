# CallScript V2 – Lessons & Patterns

Add entries ONLY when solving tricky problems.

---

## Patterns

- Ringba `callDt` is a Unix ms timestamp → always normalize to UTC.
- Always query workers using `ORDER BY start_time_utc DESC`.
- When transitioning statuses, update `updated_at` for dashboard accuracy.

---

## Lessons

- Diarization overlaps must be normalized before saving transcript segments.
- RunPod workers may OOM on long diarization → batch >10min tasks.

