-- 08_drop_ghost_views.sql
-- Drop undocumented views that were created outside migrations.
-- This ensures schema reproducibility and prevents drift.

-- Drop ringba_calls_latest if it exists (was created manually, not in migrations)
DROP VIEW IF EXISTS public.ringba_calls_latest CASCADE;

-- Drop call_ingestion_stats if it exists (also undocumented)
DROP VIEW IF EXISTS public.call_ingestion_stats CASCADE;
