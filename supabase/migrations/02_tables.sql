-- Core tables: campaigns and calls

CREATE TABLE IF NOT EXISTS core.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ringba_campaign_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    vertical TEXT DEFAULT 'General',
    inference_source TEXT CHECK (
        inference_source IN ('regex', 'manual', 'unknown')
    ) DEFAULT 'unknown',
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ringba_call_id TEXT NOT NULL UNIQUE,
    campaign_id UUID REFERENCES core.campaigns(id),

    start_time_utc TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    caller_number TEXT,
    duration_seconds INTEGER,
    revenue NUMERIC(12,4) DEFAULT 0,

    audio_url TEXT,
    storage_path TEXT,

    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    processing_error TEXT,

    transcript_text TEXT,
    transcript_segments JSONB,

    qa_flags JSONB,
    qa_version TEXT,
    judge_model TEXT,

    CONSTRAINT valid_processing_state CHECK (
        status != 'processing' OR storage_path IS NOT NULL
    ),

    CONSTRAINT status_valid CHECK (
        status IN (
            'pending',
            'downloaded',
            'processing',
            'transcribed',
            'flagged',
            'safe',
            'failed'
        )
    ),

    CONSTRAINT retry_limit CHECK (retry_count <= 3)
);
