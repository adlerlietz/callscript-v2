# Judge Lane Documentation

## Overview

The Judge Lane is the final stage of the CallScript V2 pipeline. It analyzes transcribed calls using OpenAI GPT-4o-mini and assigns quality scores, compliance checks, and sentiment analysis.

## Architecture

**Location:** `/workspace/judge.py` (RunPod Server)
**Model:** `gpt-4o-mini` (Cost: ~$0.15 per 1M tokens)
**Dependencies:** `openai>=1.12.0`, `pydantic>=2.0.0`, `tenacity>=8.2.0`

## Data Flow

```
core.calls (status='transcribed')
    ↓
Judge Worker polls for unanalyzed calls
    ↓
Send transcript to GPT-4o-mini with structured output
    ↓
Save QA results to core.calls.qa_flags (JSONB)
    ↓
Update status to 'flagged' (score < 70) or 'safe' (score >= 70)
```

## Database Schema

### Input (Query)
```sql
SELECT id, transcript_text, transcript_segments, start_time_utc
FROM core.calls
WHERE status = 'transcribed'
  AND qa_flags IS NULL
ORDER BY start_time_utc DESC  -- LIFO ordering (system invariant)
LIMIT 1
```

### Output (Update)
```sql
UPDATE core.calls SET
  qa_flags = {
    "score": 85,
    "summary": "Agent was professional but missed upsell",
    "did_greet": true,
    "did_ask_for_sale": false,
    "customer_sentiment": "positive",
    "compliance_issues": [],
    "professionalism_score": 90,
    "analyzed_at": "2025-12-12T05:13:09Z"
  },
  qa_version = "v1.0",
  judge_model = "gpt-4o-mini",
  status = "safe",  -- or "flagged" if score < 70
  updated_at = NOW()
WHERE id = 'call-uuid'
```

## QA Scoring Rubric

### Score Ranges
- **90-100**: Exceptional call. Professional, compliant, strong sales technique.
- **70-89**: Good call. Minor issues but overall acceptable.
- **50-69**: Mediocre call. Multiple issues or missed opportunities.
- **0-49**: Poor call. Major compliance issues or unprofessional behavior.

### Compliance Red Flags (TCPA/FTC)
- No consent obtained before marketing
- Calling outside permitted hours (8am-9pm local)
- Agent misrepresenting product or service
- Failure to disclose required information
- Aggressive or deceptive sales tactics

### Professionalism Criteria
- Clear communication
- Active listening
- Appropriate tone and language
- Proper call flow (greeting, discovery, close)

## Structured Output Schema

```python
class QAAnalysis(BaseModel):
    score: int = Field(..., ge=0, le=100, description="Overall quality score 0-100")
    summary: str = Field(..., description="Brief 1-2 sentence summary of the call")
    did_greet: bool = Field(..., description="Agent properly greeted the customer")
    did_ask_for_sale: bool = Field(..., description="Agent attempted to sell or upsell")
    customer_sentiment: str = Field(..., description="positive, neutral, or negative")
    compliance_issues: list[str] = Field(default_factory=list, description="List of compliance violations found")
    professionalism_score: int = Field(..., ge=0, le=100, description="Agent professionalism 0-100")
```

## System Prompt

```
You are an expert QA Analyst for a Pay-Per-Call marketing operation.

Your job is to analyze call transcripts and score them based on quality, compliance, and professionalism.

**Scoring Guidelines:**
- **90-100**: Exceptional call. Professional, compliant, strong sales technique.
- **70-89**: Good call. Minor issues but overall acceptable.
- **50-69**: Mediocre call. Multiple issues or missed opportunities.
- **0-49**: Poor call. Major compliance issues, unprofessional behavior, or call quality problems.

**Compliance Red Flags (TCPA/FTC):**
- No consent obtained before marketing
- Calling outside permitted hours (8am-9pm local)
- Agent misrepresenting product or service
- Failure to disclose required information
- Aggressive or deceptive sales tactics

**Professionalism Criteria:**
- Clear communication
- Active listening
- Appropriate tone and language
- Proper call flow (greeting, discovery, close)

Analyze the transcript and provide a structured assessment.
```

## Retry Logic

Uses `tenacity` for automatic retries on OpenAI API errors:

```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True
)
def analyze_with_gpt(transcript: str) -> QAAnalysis:
    # OpenAI API call with structured outputs
    ...
```

## Deployment

### Environment Variables
```bash
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://biisnqdzegocchcpegdw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

### Launch Script
```bash
/workspace/start_judge.sh
```

### Monitor Logs
```bash
tail -f /workspace/judge.log
```

### Check Process Status
```bash
ps aux | grep judge.py
```

## Performance Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| **Latency** | < 5 seconds per call | ~2-3 seconds |
| **Cost** | < $0.0002 per call | ~$0.00015 |
| **Throughput** | 100+ calls/minute | Limited by OpenAI rate limits |
| **Accuracy** | > 90% human agreement | TBD (requires validation) |

## Error Handling

### Skipped Calls
Calls with transcripts < 10 characters are skipped and logged:
```
⚠️ [2025-12-12 05:13:09] Skipping call 33057bdc: transcript too short
```

### API Failures
OpenAI API errors trigger automatic retries (max 3 attempts):
```
❌ [2025-12-12 05:13:10] Error processing call 33057bdc: Rate limit exceeded
```

### Database Errors
Database connection errors are logged and the worker continues polling:
```
❌ [2025-12-12 05:13:11] Database error fetching call: Connection timeout
```

## Monitoring Dashboard Queries

### Count of Judged Calls
```sql
SELECT COUNT(*)
FROM core.calls
WHERE qa_flags IS NOT NULL;
```

### Average Score by Date
```sql
SELECT
  DATE(start_time_utc) as date,
  AVG((qa_flags->>'score')::int) as avg_score,
  COUNT(*) as total_calls
FROM core.calls
WHERE qa_flags IS NOT NULL
GROUP BY DATE(start_time_utc)
ORDER BY date DESC;
```

### Flagged Calls (Score < 70)
```sql
SELECT
  id,
  start_time_utc,
  (qa_flags->>'score')::int as score,
  qa_flags->>'summary' as summary
FROM core.calls
WHERE status = 'flagged'
ORDER BY start_time_utc DESC;
```

## Troubleshooting

### Judge Not Processing Calls

1. **Check if transcription workers are running:**
   ```bash
   ssh root@$WORKER_HOST -p $WORKER_PORT -i ~/.ssh/id_ed25519 "ps aux | grep worker.py"
   ```

2. **Check if calls have transcripts:**
   ```sql
   SELECT COUNT(*) FROM core.calls WHERE status = 'transcribed';
   ```

3. **Restart judge worker:**
   ```bash
   ssh root@$WORKER_HOST -p $WORKER_PORT -i ~/.ssh/id_ed25519 "/workspace/start_judge.sh"
   ```

### OpenAI API Errors

- **Rate Limits:** Upgrade OpenAI tier or add delays between requests
- **Invalid API Key:** Check `OPENAI_API_KEY` in environment
- **Model Access:** Ensure account has access to `gpt-4o-mini`

## Future Enhancements

1. **Multi-Language Support:** Detect language and use appropriate QA criteria
2. **Custom Rubrics:** Allow per-campaign QA rules
3. **Confidence Scores:** Add uncertainty metrics to QA analysis
4. **Batch Processing:** Process multiple calls in parallel
5. **A/B Testing:** Compare different models/prompts for accuracy
