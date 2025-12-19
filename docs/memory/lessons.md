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
- **NEVER use WhisperX** - stick with NeMo Parakeet TDT for ASR.
- Ringba API doesn't support `state`/`city` columns - removed from valueColumns.
- NeMo `timestamps=True` incompatible with beam decoding (required for RTX 3090). Use proportional word alignment with diarization instead.
- NeMo Forced Aligner (NFA) requires CTC models - can't use directly with pure TDT models.
- Vault lane requires atomic locking via `storage_path` column to prevent race conditions when multiple workers process calls concurrently. Lock value format: `vault_lock:{id[:8]}`.
- Python Supabase client `.update().execute()` returns empty `response.data` list when no rows match WHERE conditions - use this for optimistic lock detection.

