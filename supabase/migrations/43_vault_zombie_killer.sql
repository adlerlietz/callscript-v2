-- Migration 43: Vault Zombie Killer - release stale vault locks
--
-- Problem: If a Vault worker crashes mid-download, the call remains locked
-- with storage_path = 'vault_lock:...' and status = 'pending' forever.
--
-- Solution: Periodic cleanup resets storage_path to NULL for stale locks,
-- allowing the call to be picked up by another worker.

-- Function to release stale vault locks
CREATE OR REPLACE FUNCTION core.release_stale_vault_locks(
    p_ttl_minutes INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE core.calls
    SET
        storage_path = NULL,
        processing_error = COALESCE(processing_error, '') || ' [Vault lock released at ' || now() || ']',
        updated_at = now()
    WHERE
        status = 'pending'
        AND storage_path LIKE 'vault_lock:%'
        AND updated_at < (now() - (p_ttl_minutes || ' minutes')::INTERVAL);

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        RAISE NOTICE 'Released % stale vault lock(s)', v_count;
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION core.release_stale_vault_locks IS
'Releases vault locks that have been held for longer than TTL. Called by zombie killer cron.';

-- Update the zombie killer to also release stale vault locks
CREATE OR REPLACE FUNCTION core.reset_stuck_calls()
RETURNS INTEGER AS $$
DECLARE
    v_processing_count INTEGER;
    v_vault_count INTEGER;
BEGIN
    -- 1. Reset stuck processing calls (original behavior)
    UPDATE core.calls
    SET
        status = 'downloaded',
        retry_count = retry_count + 1,
        processing_error = COALESCE(processing_error, '') || ' [Zombie reset at ' || now() || ']',
        updated_at = now()
    WHERE
        status = 'processing'
        AND updated_at < (now() - INTERVAL '30 minutes')
        AND retry_count < 3;

    GET DIAGNOSTICS v_processing_count = ROW_COUNT;

    -- 2. Release stale vault locks (new behavior)
    SELECT core.release_stale_vault_locks(30) INTO v_vault_count;

    -- Return total reset count
    RETURN v_processing_count + v_vault_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION core.reset_stuck_calls IS
'Zombie killer: resets stuck processing calls AND releases stale vault locks. Called every 30 min by cron.';
