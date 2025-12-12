#!/usr/bin/env python3
"""
CallScript V2 - Factory Lane Worker (Self-Contained)
Transcription + Diarization using NeMo Parakeet TDT + Pyannote

Server: RunPod (Ubuntu 22.04, RTX 3090 GPU)
Database: Supabase (PostgreSQL)

FIX: Uses ASRModel factory to properly load TDT architecture models.
"""

import gc
import logging
import os
import signal
import subprocess
import sys
import time

import torch
import nemo.collections.asr as nemo_asr
from pyannote.audio import Pipeline
from supabase import create_client, Client
from tenacity import retry, stop_after_attempt, wait_exponential, before_sleep_log


# =============================================================================
# SELF-CONTAINED CONFIG (No external files)
# =============================================================================
class Config:
    """Runtime configuration from environment variables."""

    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    HF_TOKEN = os.getenv("HF_TOKEN")
    TMP_DIR = "/tmp/callscript"
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

    @classmethod
    def validate(cls):
        """Validate required environment variables exist."""
        required = {
            "SUPABASE_URL": cls.SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": cls.SUPABASE_KEY,
            "HF_TOKEN": cls.HF_TOKEN,
        }
        missing = [k for k, v in required.items() if not v]
        if missing:
            raise ValueError(f"Missing required environment variables: {', '.join(missing)}")


# =============================================================================
# LOGGING SETUP (stdout + file)
# =============================================================================
LOG_PATH = "/workspace/worker.log"

logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_PATH, mode="a"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("worker")


# =============================================================================
# STARTUP VALIDATION
# =============================================================================
logger.info("=" * 60)
logger.info("CallScript V2 Factory Worker Starting")
logger.info("=" * 60)

try:
    Config.validate()
    logger.info("Config validated")
except ValueError as e:
    logger.critical(f"Config validation failed: {e}")
    sys.exit(1)

os.makedirs(Config.TMP_DIR, exist_ok=True)
os.environ["TMPDIR"] = Config.TMP_DIR


# =============================================================================
# MODEL LOADING
# =============================================================================
logger.info("Loading Parakeet TDT (nvidia/parakeet-tdt-0.6b-v2)...")
try:
    from omegaconf import OmegaConf

    # Load model
    asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name="nvidia/parakeet-tdt-0.6b-v2")
    asr_model.cuda()
    asr_model.eval()

    # CRITICAL FIX: Switch to beam decoding to avoid CUDA graph issues on RTX 3090
    # The default greedy_batch strategy uses CUDA graphs which fail with "CUDA failure! 35"
    decoding_cfg = OmegaConf.create({
        "strategy": "beam",
        "model_type": "tdt",
        "durations": [0, 1, 2, 3, 4],
        "beam": {
            "beam_size": 1,
            "return_best_hypothesis": True,
            "score_norm": True,
            "tsd_max_sym_exp": 50,
            "alsd_max_target_len": 2.0,
        },
    })
    asr_model.change_decoding_strategy(decoding_cfg)
    logger.info("Parakeet TDT loaded with beam decoding strategy")
except Exception as e:
    logger.critical(f"Failed to load Parakeet: {e}")
    sys.exit(1)

logger.info("Loading Pyannote speaker-diarization-3.1...")
try:
    # Pyannote 3.x+ uses 'token' instead of deprecated 'use_auth_token'
    diarization_pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=Config.HF_TOKEN,
    )
    diarization_pipeline.to(torch.device("cuda"))
    logger.info("Pyannote loaded successfully")
except Exception as e:
    logger.critical(f"Failed to load Pyannote: {e}")
    sys.exit(1)

logger.info("Connecting to Supabase...")
supabase: Client = create_client(Config.SUPABASE_URL, Config.SUPABASE_KEY)
logger.info("Supabase connected")

logger.info(f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None'}")
logger.info(f"Log file: {LOG_PATH}")
logger.info("=" * 60)


# =============================================================================
# SIGNAL HANDLERS
# =============================================================================
def signal_handler(sig, frame):
    """Handle graceful shutdown."""
    logger.info("Shutdown signal received, exiting...")
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


# =============================================================================
# DATABASE OPERATIONS
# =============================================================================
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
)
def fetch_and_lock():
    """
    Fetch next call from queue (LIFO) and atomically lock it.

    Returns:
        Call dict or None if queue empty or lock failed
    """
    # LIFO: ORDER BY start_time_utc DESC
    # Filter out calls that have hit retry limit (retry_count < 3)
    response = (
        supabase.schema("core")
        .from_("calls")
        .select("id, storage_path, retry_count")
        .eq("status", "downloaded")
        .lt("retry_count", 3)
        .order("start_time_utc", desc=True)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    call = response.data[0]
    call_id = call["id"]
    retry_count = (call.get("retry_count") or 0) + 1

    # Atomic lock: only succeeds if status is still 'downloaded'
    lock = (
        supabase.schema("core")
        .from_("calls")
        .update({"status": "processing", "retry_count": retry_count})
        .eq("id", call_id)
        .eq("status", "downloaded")
        .execute()
    )

    if not lock.data:
        logger.warning(f"Lock failed for {call_id}, likely claimed by another worker")
        return None

    return call


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
)
def save_results(call_id: str, transcript_text: str, segments: list):
    """
    Save transcription results to database.

    Args:
        call_id: UUID of the call
        transcript_text: Full transcript text
        segments: List of diarization segments
    """
    supabase.schema("core").from_("calls").update({
        "status": "transcribed",
        "transcript_text": transcript_text,
        "transcript_segments": segments,
        "updated_at": "now()",
    }).eq("id", call_id).execute()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
)
def mark_error(call_id: str, error_msg: str, retry_count: int):
    """
    Mark call as failed or reset for retry.

    Args:
        call_id: UUID of the call
        error_msg: Error message
        retry_count: Current retry count
    """
    new_status = "failed" if retry_count >= 3 else "downloaded"

    supabase.schema("core").from_("calls").update({
        "status": new_status,
        "processing_error": error_msg[:500],
    }).eq("id", call_id).execute()

    if new_status == "failed":
        logger.error(f"Call {call_id} permanently failed after {retry_count} attempts")
    else:
        logger.warning(f"Call {call_id} reset to downloaded (attempt {retry_count}/3)")


# =============================================================================
# MAIN PROCESSING
# =============================================================================
def process_call() -> bool:
    """
    Fetch and process one call from the queue (LIFO order).

    Returns:
        True if a call was processed, False if queue empty or error
    """
    local_mp3 = None
    local_wav = None
    call_id = "unknown"
    retry_count = 0

    try:
        # 1. FETCH & LOCK
        call = fetch_and_lock()
        if not call:
            return False

        call_id = call["id"]
        retry_count = call.get("retry_count") or 1
        storage_path = call["storage_path"]

        logger.info(f"Processing {call_id}...")

        local_mp3 = os.path.join(Config.TMP_DIR, f"{call_id}.mp3")
        local_wav = os.path.join(Config.TMP_DIR, f"{call_id}_mono.wav")

        # 2. DOWNLOAD
        logger.info(f"Downloading: {storage_path}")
        audio_bytes = supabase.storage.from_("calls_audio").download(storage_path)
        with open(local_mp3, "wb") as f:
            f.write(audio_bytes)
        logger.info(f"Downloaded {len(audio_bytes)} bytes")

        # 3. CONVERT to 16kHz Mono WAV (required for Parakeet)
        subprocess.run(
            ["ffmpeg", "-y", "-i", local_mp3, "-ac", "1", "-ar", "16000", local_wav],
            check=True,
            capture_output=True,
        )
        logger.info("Converted to 16kHz mono WAV")

        # 4. TRANSCRIBE (Parakeet TDT)
        # CRITICAL: TDT models REQUIRE return_hypotheses=True
        logger.info("Starting transcription...")
        # NeMo 2.x API uses 'audio' parameter, not 'paths2audio_files'
        hypotheses = asr_model.transcribe(
            audio=[local_wav],
            return_hypotheses=True,
        )

        # Extract text from Hypothesis object
        if hypotheses and len(hypotheses) > 0:
            hypothesis = hypotheses[0]
            # Handle different return types
            if hasattr(hypothesis, "text"):
                transcript_text = hypothesis.text
            elif isinstance(hypothesis, str):
                transcript_text = hypothesis
            else:
                transcript_text = str(hypothesis)
        else:
            transcript_text = ""

        logger.info(f"Transcription complete - Len: {len(transcript_text)} chars")

        if len(transcript_text) == 0:
            logger.warning(f"Empty transcript for {call_id} - check audio quality")

        # 5. DIARIZE (Pyannote)
        logger.info("Starting diarization...")
        diarization_result = diarization_pipeline(local_wav)

        segments = []
        # Pyannote 4.x returns DiarizeOutput with speaker_diarization attribute
        if hasattr(diarization_result, "speaker_diarization"):
            diarization = diarization_result.speaker_diarization
        else:
            diarization = diarization_result

        # Handle both old and new API
        if hasattr(diarization, "itertracks"):
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append({
                    "start": round(turn.start, 3),
                    "end": round(turn.end, 3),
                    "speaker": str(speaker),
                })
        else:
            # Pyannote 4.x format - iterate directly
            for segment in diarization:
                segments.append({
                    "start": round(segment.start, 3),
                    "end": round(segment.end, 3),
                    "speaker": str(segment.speaker) if hasattr(segment, "speaker") else "SPEAKER_00",
                })
        logger.info(f"Diarization complete - {len(segments)} segments")

        # 6. SAVE
        save_results(call_id, transcript_text, segments)
        logger.info(f"COMPLETED {call_id} | Len: {len(transcript_text)} | Segments: {len(segments)}")

        return True

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Error processing {call_id}: {error_msg[:200]}")

        if call_id != "unknown":
            mark_error(call_id, error_msg, retry_count)

        return False

    finally:
        # CRUCIAL: Cleanup to prevent VRAM leaks
        for path in [local_mp3, local_wav]:
            try:
                if path and os.path.exists(path):
                    os.remove(path)
            except OSError as e:
                logger.warning(f"Failed to remove {path}: {e}")

        # Free GPU memory after EVERY call
        torch.cuda.empty_cache()
        gc.collect()


# =============================================================================
# ENTRY POINT
# =============================================================================
if __name__ == "__main__":
    logger.info("Worker loop started (TDT Fix Applied)")

    while True:
        try:
            if not process_call():
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Worker stopped by user")
            break
        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")
            time.sleep(5)
