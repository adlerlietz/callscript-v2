-- =============================================================================
-- Vault Locking SQL Verification Tests
-- =============================================================================
-- Run with: PGPASSWORD="xxx" psql -h db.xxx.supabase.co -p 6543 -U postgres -d postgres -f scripts/test_vault_locking.sql
-- Or copy/paste sections into psql interactively.

\echo '============================================================'
\echo 'VAULT LOCKING SQL VERIFICATION'
\echo '============================================================'

-- =============================================================================
-- SETUP: Create test call
-- =============================================================================
\echo ''
\echo 'SETUP: Creating test call...'

DO $$
DECLARE
    v_call_id UUID := gen_random_uuid();
    v_ringba_id TEXT := 'TEST-' || LEFT(v_call_id::text, 8);
BEGIN
    INSERT INTO core.calls (
        id, ringba_call_id, org_id, status, audio_url, storage_path, start_time_utc
    ) VALUES (
        v_call_id,
        v_ringba_id,
        '00000000-0000-0000-0000-000000000001',
        'pending',
        'https://example.com/test.mp3',
        NULL,
        now()
    );

    RAISE NOTICE 'Created test call: %', v_call_id;

    -- Store for later tests
    PERFORM set_config('test.call_id', v_call_id::text, false);
END;
$$;

-- =============================================================================
-- TEST 1: Atomic Lock Acquisition (Single-threaded simulation)
-- =============================================================================
\echo ''
\echo '============================================================'
\echo 'TEST 1: Atomic Lock Acquisition'
\echo '============================================================'

-- First lock attempt should succeed
\echo 'Attempt 1: Trying to acquire lock...'
UPDATE core.calls
SET
    storage_path = 'vault_lock:test0001',
    updated_at = now()
WHERE
    id = current_setting('test.call_id')::uuid
    AND status = 'pending'
    AND storage_path IS NULL
RETURNING id, storage_path AS "Lock acquired";

-- Second lock attempt should fail (returns 0 rows)
\echo ''
\echo 'Attempt 2: Trying to acquire same lock (should return 0 rows)...'
UPDATE core.calls
SET
    storage_path = 'vault_lock:test0002',
    updated_at = now()
WHERE
    id = current_setting('test.call_id')::uuid
    AND status = 'pending'
    AND storage_path IS NULL
RETURNING id, storage_path AS "Lock acquired (should be empty)";

-- Verify current state
\echo ''
\echo 'Current state:'
SELECT id, status, storage_path, updated_at
FROM core.calls
WHERE id = current_setting('test.call_id')::uuid;

-- =============================================================================
-- TEST 2: Transient Failure Lock Release
-- =============================================================================
\echo ''
\echo '============================================================'
\echo 'TEST 2: Transient Failure Lock Release'
\echo '============================================================'

-- Simulate transient failure: release lock, keep status='pending'
\echo 'Simulating transient failure...'
UPDATE core.calls
SET
    storage_path = NULL,
    processing_error = 'Simulated transient error',
    updated_at = now()
WHERE id = current_setting('test.call_id')::uuid;

-- Verify: status='pending', storage_path=NULL
\echo ''
\echo 'State after transient failure (should be pending, NULL):'
SELECT
    status,
    storage_path,
    processing_error
FROM core.calls
WHERE id = current_setting('test.call_id')::uuid;

-- =============================================================================
-- TEST 3: Permanent Error (404)
-- =============================================================================
\echo ''
\echo '============================================================'
\echo 'TEST 3: Permanent Error (404)'
\echo '============================================================'

-- Re-acquire lock first
UPDATE core.calls
SET storage_path = 'vault_lock:test0003', updated_at = now()
WHERE id = current_setting('test.call_id')::uuid;

-- Simulate 404 permanent failure
\echo 'Simulating 404 error...'
UPDATE core.calls
SET
    storage_path = NULL,
    status = 'failed',
    processing_error = 'Audio URL expired or unavailable (HTTP 404)',
    updated_at = now()
WHERE id = current_setting('test.call_id')::uuid;

-- Verify: status='failed', storage_path=NULL
\echo ''
\echo 'State after 404 error (should be failed, NULL):'
SELECT
    status,
    storage_path,
    processing_error
FROM core.calls
WHERE id = current_setting('test.call_id')::uuid;

-- =============================================================================
-- TEST 4: Zombie Cleanup
-- =============================================================================
\echo ''
\echo '============================================================'
\echo 'TEST 4: Zombie Cleanup (Stale Lock)'
\echo '============================================================'

-- Reset to pending with stale lock
\echo 'Creating stale lock (backdated 31 minutes)...'
UPDATE core.calls
SET
    status = 'pending',
    storage_path = 'vault_lock:stale001',
    updated_at = now() - INTERVAL '31 minutes',
    processing_error = NULL
WHERE id = current_setting('test.call_id')::uuid;

-- Show before state
\echo ''
\echo 'Before zombie cleanup:'
SELECT
    status,
    storage_path,
    updated_at,
    age(now(), updated_at) AS "age"
FROM core.calls
WHERE id = current_setting('test.call_id')::uuid;

-- Run zombie cleanup
\echo ''
\echo 'Running core.release_stale_vault_locks(30)...'
SELECT core.release_stale_vault_locks(30) AS "Locks released";

-- Verify lock was released
\echo ''
\echo 'After zombie cleanup (should be pending, NULL):'
SELECT
    status,
    storage_path,
    processing_error
FROM core.calls
WHERE id = current_setting('test.call_id')::uuid;

-- =============================================================================
-- CLEANUP
-- =============================================================================
\echo ''
\echo '============================================================'
\echo 'CLEANUP'
\echo '============================================================'

DELETE FROM core.calls WHERE id = current_setting('test.call_id')::uuid;
\echo 'Test call deleted.'

-- =============================================================================
-- BONUS: Check for any orphaned test calls
-- =============================================================================
\echo ''
\echo 'Checking for orphaned test calls...'
SELECT id, ringba_call_id, status, storage_path
FROM core.calls
WHERE ringba_call_id LIKE 'TEST-%'
LIMIT 10;

\echo ''
\echo 'Done.'
