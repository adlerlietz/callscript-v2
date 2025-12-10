-- Triggers: updated_at, auto-tag campaigns, zombie killer

-- 1. updated_at helper
CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaigns_set_updated_at ON core.campaigns;
CREATE TRIGGER trg_campaigns_set_updated_at
BEFORE UPDATE ON core.campaigns
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS trg_calls_set_updated_at ON core.calls;
CREATE TRIGGER trg_calls_set_updated_at
BEFORE UPDATE ON core.calls
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

-- 2. auto-tag campaign vertical by regex
CREATE OR REPLACE FUNCTION core.infer_campaign_vertical()
RETURNS TRIGGER AS $$
DECLARE
    v_vertical TEXT := 'General';
    v_source   TEXT := 'unknown';
BEGIN
    IF NEW.name ~* 'ACA' THEN
        v_vertical := 'ACA';
        v_source := 'regex';
    ELSIF NEW.name ~* 'Medicare' THEN
        v_vertical := 'Medicare';
        v_source := 'regex';
    ELSIF NEW.name ~* 'FE' OR NEW.name ~* 'Final Expense' THEN
        v_vertical := 'Final Expense';
        v_source := 'regex';
    ELSIF NEW.name ~* 'Auto' THEN
        v_vertical := 'Auto';
        v_source := 'regex';
    END IF;

    IF NOT COALESCE(NEW.is_verified, false) THEN
        NEW.vertical := v_vertical;
        NEW.inference_source := v_source;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaigns_infer_vertical ON core.campaigns;
CREATE TRIGGER trg_campaigns_infer_vertical
BEFORE INSERT OR UPDATE ON core.campaigns
FOR EACH ROW
EXECUTE FUNCTION core.infer_campaign_vertical();

-- 3. Zombie Killer – reset stuck processing calls
CREATE OR REPLACE FUNCTION core.reset_stuck_calls()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
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

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
