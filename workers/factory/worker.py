#!/usr/bin/env python3
"""
CallScript V2 - Factory Lane Worker

Transcription + Diarization pipeline using:
- NeMo Parakeet TDT 0.6B (ASR)
- Pyannote 3.1 (Speaker Diarization)

Server: RunPod (Ubuntu 22.04, RTX 3090 GPU)
Database: Supabase (PostgreSQL)

This is the refactored version using workers/core modules.
"""

import gc
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import torch
from supabase import create_client

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from workers.core import (
    get_settings,
    setup_logging,
    load_asr_model,
    load_diarization_pipeline,
    verify_gpu_available,
    transcribe,
    diarize,
    CallsRepository,
)


# =============================================================================
# GLOBALS
# =============================================================================
shutdown_requested = False


def signal_handler(sig, frame):
    """Handle graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    logger.info("Shutdown signal received, finishing current job...")


# =============================================================================
# AUDIO PROCESSING
# =============================================================================
def convert_to_wav(input_path: str, output_path: str) -> None:
    """
    Convert audio to 16kHz mono WAV (required for Parakeet).

    Args:
        input_path: Path to input audio file (mp3, etc.)
        output_path: Path for output WAV file
    """
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", output_path],
        check=True,
        capture_output=True,
    )


def cleanup_files(*paths: str) -> None:
    """Remove temporary files, ignoring errors."""
    for path in paths:
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except OSError as e:
            logger.warning(f"Failed to remove {path}: {e}")


# =============================================================================
# MAIN PROCESSING
# =============================================================================
def process_call(
    call: dict,
    repo: CallsRepository,
    asr_model,
    diarizer,
    settings,
) -> bool:
    """
    Process a single call through the transcription pipeline.

    Args:
        call: Call dict with id, storage_path, retry_count
        repo: Database repository
        asr_model: Loaded ASR model
        diarizer: Loaded diarization pipeline
        settings: Application settings

    Returns:
        True if successful, False if failed
    """
    call_id = call["id"]
    storage_path = call["storage_path"]
    retry_count = call.get("retry_count", 0)

    # Setup temp paths
    tmp_dir = settings.tmp_dir
    os.makedirs(tmp_dir, exist_ok=True)
    local_mp3 = os.path.join(tmp_dir, f"{call_id}.mp3")
    local_wav = os.path.join(tmp_dir, f"{call_id}_mono.wav")

    try:
        # -----------------------------------------------------------------
        # Step 1: Lock the call
        # -----------------------------------------------------------------
        locked = repo.lock_call(call_id, retry_count)
        if not locked:
            return False  # Another worker claimed it

        logger.info(f"Processing {call_id}...")

        # -----------------------------------------------------------------
        # Step 2: Download audio
        # -----------------------------------------------------------------
        logger.info(f"Downloading: {storage_path}")
        audio_bytes = repo.download_audio(storage_path)
        with open(local_mp3, "wb") as f:
            f.write(audio_bytes)
        logger.info(f"Downloaded {len(audio_bytes)} bytes")

        # -----------------------------------------------------------------
        # Step 3: Convert to WAV
        # -----------------------------------------------------------------
        convert_to_wav(local_mp3, local_wav)
        logger.info("Converted to 16kHz mono WAV")

        # -----------------------------------------------------------------
        # Step 4: Transcribe
        # -----------------------------------------------------------------
        logger.info("Starting transcription...")
        transcript_text = transcribe(asr_model, local_wav)
        logger.info(f"Transcription complete - Len: {len(transcript_text)} chars")

        if len(transcript_text) == 0:
            logger.warning(f"Empty transcript for {call_id} - check audio quality")

        # -----------------------------------------------------------------
        # Step 5: Diarize
        # -----------------------------------------------------------------
        logger.info("Starting diarization...")
        segments = diarize(diarizer, local_wav)
        logger.info(f"Diarization complete - {len(segments)} segments")

        # -----------------------------------------------------------------
        # Step 6: Save results
        # -----------------------------------------------------------------
        repo.save_transcription(call_id, transcript_text, segments)
        logger.info(f"COMPLETED {call_id} | Len: {len(transcript_text)} | Segments: {len(segments)}")

        return True

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Error processing {call_id}: {error_msg[:200]}")

        # Mark as failed/retry
        try:
            repo.mark_failed(call_id, error_msg, retry_count + 1)
        except Exception as db_error:
            logger.error(f"Failed to update error status: {db_error}")

        return False

    finally:
        # CRUCIAL: Always cleanup to prevent disk/VRAM leaks
        cleanup_files(local_mp3, local_wav)
        torch.cuda.empty_cache()
        gc.collect()


# =============================================================================
# MAIN LOOP
# =============================================================================
def main():
    """Main worker entry point."""
    global logger

    # -----------------------------------------------------------------
    # Initialize
    # -----------------------------------------------------------------
    settings = get_settings()
    logger = setup_logging("worker", settings.worker_log_path, settings.log_level)

    logger.info("=" * 60)
    logger.info("CallScript V2 Factory Worker Starting (Refactored)")
    logger.info("=" * 60)

    # Setup signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Ensure tmp directory exists
    os.makedirs(settings.tmp_dir, exist_ok=True)
    os.environ["TMPDIR"] = settings.tmp_dir

    # -----------------------------------------------------------------
    # Verify GPU
    # -----------------------------------------------------------------
    try:
        gpu_info = verify_gpu_available()
        logger.info(f"GPU: {gpu_info['device']} ({gpu_info['memory_total_gb']} GB)")
    except RuntimeError as e:
        logger.critical(f"GPU verification failed: {e}")
        sys.exit(1)

    # -----------------------------------------------------------------
    # Load Models
    # -----------------------------------------------------------------
    try:
        asr_model = load_asr_model(settings)
        logger.info("ASR model loaded with beam decoding strategy")
    except Exception as e:
        logger.critical(f"Failed to load ASR model: {e}")
        sys.exit(1)

    try:
        diarizer = load_diarization_pipeline(settings)
        logger.info("Diarization pipeline loaded")
    except Exception as e:
        logger.critical(f"Failed to load diarization pipeline: {e}")
        sys.exit(1)

    # -----------------------------------------------------------------
    # Connect to Database
    # -----------------------------------------------------------------
    try:
        supabase_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        repo = CallsRepository(supabase_client)
        logger.info("Connected to Supabase")
    except Exception as e:
        logger.critical(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    # -----------------------------------------------------------------
    # Log startup summary
    # -----------------------------------------------------------------
    logger.info(f"Config: ASR={settings.asr_model}, Decoding={settings.decoding_strategy}")
    logger.info(f"Log file: {settings.worker_log_path}")
    logger.info("=" * 60)
    logger.info("Worker loop started")

    # -----------------------------------------------------------------
    # Main Loop
    # -----------------------------------------------------------------
    processed_count = 0
    error_count = 0

    while not shutdown_requested:
        try:
            # Fetch next call from queue
            call = repo.fetch_next_pending_call()

            if call is None:
                # Queue empty - wait and retry
                time.sleep(settings.poll_interval)
                continue

            # Process the call
            success = process_call(call, repo, asr_model, diarizer, settings)

            if success:
                processed_count += 1
                if processed_count % 10 == 0:
                    logger.info(f"Milestone: {processed_count} calls processed")
            else:
                error_count += 1

        except KeyboardInterrupt:
            logger.info("Worker stopped by user")
            break

        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")
            error_count += 1
            time.sleep(5)  # Back off on unexpected errors

    # -----------------------------------------------------------------
    # Shutdown
    # -----------------------------------------------------------------
    logger.info("=" * 60)
    logger.info(f"Worker shutdown - Processed: {processed_count}, Errors: {error_count}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
