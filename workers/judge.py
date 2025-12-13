#!/usr/bin/env python3
"""
Judge Lane - CallScript V2
Analyzes transcribed calls using OpenAI GPT-4o and saves QA scores.
"""

import os
import time
import json
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
from supabase import create_client, Client
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

# ============================================================================
# Configuration
# ============================================================================

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY]):
    raise ValueError("Missing required environment variables")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)

QA_VERSION = "v1.0"
MODEL_NAME = "gpt-4o-mini"
POLL_INTERVAL = 5  # seconds

# ============================================================================
# Pydantic Models for Structured Outputs
# ============================================================================

class QAAnalysis(BaseModel):
    """Structured QA analysis response from GPT-4o"""
    score: int = Field(..., ge=0, le=100, description="Overall quality score 0-100")
    summary: str = Field(..., description="Brief 1-2 sentence summary of the call")
    did_greet: bool = Field(..., description="Agent properly greeted the customer")
    did_ask_for_sale: bool = Field(..., description="Agent attempted to sell or upsell")
    customer_sentiment: str = Field(..., description="positive, neutral, or negative")
    compliance_issues: list[str] = Field(default_factory=list, description="List of compliance violations found")
    professionalism_score: int = Field(..., ge=0, le=100, description="Agent professionalism 0-100")

# ============================================================================
# System Prompt for QA Analysis
# ============================================================================

SYSTEM_PROMPT = """You are an expert QA Analyst for a Pay-Per-Call marketing operation.

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

Analyze the transcript and provide a structured assessment."""

# ============================================================================
# Core Functions
# ============================================================================

def log(msg: str, emoji: str = "ℹ️"):
    """Structured logging with timestamp"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"{emoji} [{timestamp}] {msg}", flush=True)

def get_next_call() -> Optional[Dict[str, Any]]:
    """
    Fetch the next transcribed call that hasn't been judged yet.
    Uses LIFO ordering (newest first) per system invariant.
    """
    try:
        response = supabase.schema("core").table("calls") \
            .select("id, transcript_text, transcript_segments, start_time_utc") \
            .eq("status", "transcribed") \
            .is_("qa_flags", "null") \
            .order("start_time_utc", desc=True) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return response.data[0]
        return None
    except Exception as e:
        log(f"Database error fetching call: {e}", "❌")
        return None

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True
)
def analyze_with_gpt(transcript: str) -> QAAnalysis:
    """
    Analyze transcript using OpenAI GPT-4o with structured outputs.
    Uses tenacity for automatic retries on API errors.
    """
    log(f"Sending to GPT-4o-mini (length: {len(transcript)} chars)", "🤖")

    completion = openai_client.beta.chat.completions.parse(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Analyze this call transcript:\n\n{transcript}"}
        ],
        response_format=QAAnalysis,
        temperature=0.3,
        max_tokens=1000
    )

    analysis = completion.choices[0].message.parsed
    log(f"GPT Analysis: Score={analysis.score}, Sentiment={analysis.customer_sentiment}", "✅")
    return analysis

def save_qa_results(call_id: str, analysis: QAAnalysis) -> bool:
    """
    Save QA analysis to database and update call status.
    Status becomes 'flagged' if score < 70, otherwise 'safe'.
    """
    try:
        # Determine final status based on score
        new_status = "flagged" if analysis.score < 70 else "safe"

        # Prepare QA flags JSONB
        qa_flags = {
            "score": analysis.score,
            "summary": analysis.summary,
            "did_greet": analysis.did_greet,
            "did_ask_for_sale": analysis.did_ask_for_sale,
            "customer_sentiment": analysis.customer_sentiment,
            "compliance_issues": analysis.compliance_issues,
            "professionalism_score": analysis.professionalism_score,
            "analyzed_at": datetime.utcnow().isoformat()
        }

        # Update the call record
        response = supabase.schema("core").table("calls") \
            .update({
                "qa_flags": qa_flags,
                "qa_version": QA_VERSION,
                "judge_model": MODEL_NAME,
                "status": new_status,
                "updated_at": datetime.utcnow().isoformat()
            }) \
            .eq("id", call_id) \
            .execute()

        log(f"Saved QA results: status={new_status}, score={analysis.score}", "💾")
        return True

    except Exception as e:
        log(f"Database error saving results: {e}", "❌")
        return False

def process_call(call: Dict[str, Any]) -> bool:
    """Process a single call through the judge pipeline"""
    call_id = call["id"]
    transcript = call.get("transcript_text") or ""
    start_time = call["start_time_utc"]

    log(f"Processing call {call_id[:8]}... (from {start_time})", "⚖️")

    if len(transcript.strip()) < 50:
        log(f"Marking call {call_id[:8]} as safe: transcript too short ({len(transcript)} chars)", "⚠️")
        # Mark as safe with skip reason so it doesn't get re-fetched
        supabase.schema("core").table("calls") \
            .update({
                "qa_flags": {"skipped": True, "reason": "transcript_too_short", "length": len(transcript)},
                "qa_version": QA_VERSION,
                "judge_model": "skip",
                "status": "safe",
                "updated_at": datetime.utcnow().isoformat()
            }) \
            .eq("id", call_id) \
            .execute()
        return True  # Counts as processed

    try:
        # Analyze with GPT-4o
        analysis = analyze_with_gpt(transcript)

        # Save results
        success = save_qa_results(call_id, analysis)

        if success:
            log(f"Completed call {call_id[:8]}: {analysis.summary[:50]}...", "✅")

        return success

    except Exception as e:
        log(f"Error processing call {call_id[:8]}: {e}", "❌")
        return False

# ============================================================================
# Main Loop
# ============================================================================

def main():
    """Main judge loop - runs forever"""
    log("🎯 Judge Lane starting...", "🚀")
    log(f"Model: {MODEL_NAME}, QA Version: {QA_VERSION}", "📋")

    processed_count = 0

    while True:
        try:
            # Fetch next call
            call = get_next_call()

            if call is None:
                # No work found - sleep and retry
                time.sleep(POLL_INTERVAL)
                continue

            # Process the call
            success = process_call(call)

            if success:
                processed_count += 1
                if processed_count % 10 == 0:
                    log(f"Milestone: {processed_count} calls judged", "🎉")

        except KeyboardInterrupt:
            log("Shutting down gracefully...", "👋")
            break

        except Exception as e:
            log(f"Unexpected error in main loop: {e}", "❌")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
