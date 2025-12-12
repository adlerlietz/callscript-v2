#!/usr/bin/env python3
"""
Debug Worker - CallScript V2
Extreme logging to diagnose empty transcript bug.
"""

import os
import sys
import gc
import time
import signal
import logging
import subprocess
import tempfile
from typing import Optional, Dict, Any
from datetime import datetime

import torch
import nemo.collections.asr as nemo_asr
from pyannote.audio import Pipeline
from supabase import create_client, Client
from tenacity import retry, stop_after_attempt, wait_exponential

# ============================================================================
# Configuration
# ============================================================================

class Config:
    """Environment-based configuration"""
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    HF_TOKEN = os.getenv("HF_TOKEN")

    SAMPLE_RATE = 16000
    TMP_DIR = "/workspace/tmp"

    if not all([SUPABASE_URL, SUPABASE_KEY, HF_TOKEN]):
        raise ValueError("Missing required environment variables")

    os.makedirs(TMP_DIR, exist_ok=True)

# ============================================================================
# Logging Setup
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/workspace/worker.log')
    ]
)
logger = logging.getLogger(__name__)

# ============================================================================
# Model Initialization (Global - Load Once)
# ============================================================================

logger.info('🚀 Loading NeMo Parakeet ASR Model...')
try:
    asr_model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(
        model_name='nvidia/parakeet-tdt-0.6b-v2'
    )
    asr_model.cuda()
    asr_model.eval()
    logger.info('✅ Parakeet loaded successfully')
except Exception as e:
    logger.critical(f'❌ Failed to load Parakeet: {e}')
    sys.exit(1)

logger.info('🗣️ Loading Pyannote Diarization Pipeline...')
try:
    # Try new API first
    diarization_pipeline = Pipeline.from_pretrained(
        'pyannote/speaker-diarization-3.1',
        use_auth_token=Config.HF_TOKEN
    )
    diarization_pipeline.to(torch.device('cuda'))
    logger.info('✅ Pyannote loaded successfully')
except TypeError:
    try:
        diarization_pipeline = Pipeline.from_pretrained(
            'pyannote/speaker-diarization-3.1',
            token=Config.HF_TOKEN
        )
        diarization_pipeline.to(torch.device('cuda'))
        logger.info('✅ Pyannote loaded successfully (using new API)')
    except Exception as e2:
        logger.critical(f'❌ Failed to load Pyannote with new API: {e2}')
        sys.exit(1)
except Exception as e:
    logger.critical(f'❌ Failed to load Pyannote: {e}')
    sys.exit(1)

# ============================================================================
# Database Connection
# ============================================================================

logger.info('📡 Connecting to Supabase...')
try:
    supabase: Client = create_client(Config.SUPABASE_URL, Config.SUPABASE_KEY)
    logger.info('✅ Supabase connected')
except Exception as e:
    logger.critical(f'❌ Failed to connect to Supabase: {e}')
    sys.exit(1)

# ============================================================================
# Signal Handlers
# ============================================================================

def signal_handler(sig, frame):
    """Handle SIGTERM/SIGINT for graceful shutdown"""
    logger.info('🛑 Shutting down gracefully...')
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# ============================================================================
# Database Operations
# ============================================================================

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    reraise=True
)
def fetch_and_lock() -> Optional[Dict[str, Any]]:
    """
    Fetch next call from queue and atomically lock it.
    Uses LIFO ordering (newest first) per system invariant.
    """
    # Fetch next available call
    response = supabase.schema('core').from_('calls') \
        .select('*') \
        .eq('status', 'downloaded') \
        .order('start_time_utc', desc=True) \
        .limit(1) \
        .execute()

    if not response.data or len(response.data) == 0:
        return None

    call = response.data[0]

    # Atomically lock the call
    lock_response = supabase.schema('core').from_('calls') \
        .update({'status': 'processing'}) \
        .eq('id', call['id']) \
        .eq('status', 'downloaded') \
        .execute()

    # Verify lock succeeded
    if not lock_response.data or len(lock_response.data) == 0:
        logger.warning(f"⚠️ Failed to lock call {call['id'][:8]} (already locked)")
        return None

    return call

# ============================================================================
# Audio Processing
# ============================================================================

def convert_audio(input_path: str, output_path: str) -> None:
    """Convert audio to mono 16kHz WAV using ffmpeg"""
    subprocess.run(
        [
            'ffmpeg', '-y', '-i', input_path,
            '-ac', '1',  # Mono
            '-ar', str(Config.SAMPLE_RATE),  # 16kHz
            output_path
        ],
        check=True,
        capture_output=True,
        timeout=60
    )

# ============================================================================
# AI Inference (DEBUG MODE)
# ============================================================================

def transcribe_audio(audio_path: str) -> str:
    """
    🔍 DEBUG VERSION - Transcribe audio with extreme logging.

    This version logs EVERYTHING to diagnose the empty text bug.
    """
    logger.info(f'🎤 Transcribing with Parakeet (DEBUG MODE)...')
    logger.info(f'📁 Audio path: {audio_path}')
    logger.info(f'📏 File size: {os.path.getsize(audio_path)} bytes')

    # Call the model WITHOUT return_hypotheses (default behavior)
    logger.info('🔧 Calling asr_model.transcribe() with default settings...')
    results = asr_model.transcribe(
        paths2audio_files=[audio_path],
        batch_size=1  # Process one at a time to rule out batching issues
    )

    # ========================================================================
    # EXTREME LOGGING BLOCK
    # ========================================================================
    logger.info('=' * 80)
    logger.info('🔍 DEBUG OUTPUT - RAW ASR RESULT:')
    logger.info(f'TYPE: {type(results)}')
    logger.info(f'TYPE NAME: {type(results).__name__}')
    logger.info(f'MODULE: {type(results).__module__}')

    # Check if it's a list/tuple
    if isinstance(results, (list, tuple)):
        logger.info(f'LENGTH: {len(results)}')
        if len(results) > 0:
            logger.info(f'FIRST ITEM TYPE: {type(results[0])}')
            logger.info(f'FIRST ITEM CONTENT: {results[0]}')

            # Check if first item has common attributes
            if hasattr(results[0], 'text'):
                logger.info(f'HAS .text ATTRIBUTE: {results[0].text}')
            if hasattr(results[0], '__dict__'):
                logger.info(f'ATTRIBUTES: {results[0].__dict__}')
    else:
        # Not a list, log the whole thing
        logger.info(f'RAW CONTENT: {results}')
        if hasattr(results, '__dict__'):
            logger.info(f'ATTRIBUTES: {results.__dict__}')

    logger.info('=' * 80)

    # ========================================================================
    # EXTRACTION LOGIC - Try everything
    # ========================================================================
    text = ""

    try:
        # Strategy 1: Is it a string already?
        if isinstance(results, str):
            text = results
            logger.info('✅ Extraction: Direct string')

        # Strategy 2: Is it a list? Take first element
        elif isinstance(results, (list, tuple)) and len(results) > 0:
            first_item = results[0]

            # Strategy 2a: Does first item have .text?
            if hasattr(first_item, 'text'):
                text = first_item.text
                logger.info('✅ Extraction: first_item.text')

            # Strategy 2b: Is first item a string?
            elif isinstance(first_item, str):
                text = first_item
                logger.info('✅ Extraction: first_item (string)')

            # Strategy 2c: Try to stringify it
            else:
                text = str(first_item)
                logger.info('⚠️ Extraction: str(first_item) - FALLBACK')

        # Strategy 3: Does the result object itself have .text?
        elif hasattr(results, 'text'):
            text = results.text
            logger.info('✅ Extraction: results.text')

        # Strategy 4: Last resort - stringify the whole thing
        else:
            text = str(results)
            logger.info('⚠️ Extraction: str(results) - LAST RESORT')

    except Exception as e:
        logger.error(f'❌ Text extraction failed: {e}')
        text = ""

    # Final check
    logger.info(f'📊 FINAL TEXT LENGTH: {len(text)} characters')
    logger.info(f'📝 PREVIEW (first 200 chars): {text[:200]}')

    return text.strip()

def diarize_audio(audio_path: str) -> list:
    """
    Perform speaker diarization using Pyannote.
    Returns list of speaker segments with timestamps.
    """
    logger.info('👥 Diarizing with Pyannote...')

    diarization = diarization_pipeline(audio_path)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            'start': float(turn.start),
            'end': float(turn.end),
            'speaker': speaker
        })

    logger.info(f'✅ Found {len(segments)} speaker segments')
    return segments

# ============================================================================
# Main Processing Loop
# ============================================================================

def process_call() -> bool:
    """
    Process a single call through the transcription pipeline.
    Returns True if work was done, False if queue was empty.
    """
    local_path = None
    mono_path = None

    try:
        # Fetch and lock next call
        call = fetch_and_lock()
        if not call:
            return False

        call_id = call['id']
        storage_path = call['storage_path']

        logger.info(f"🔨 Processing {call_id[:8]}... (from {call['start_time_utc']})")

        # Create temporary file paths
        local_path = os.path.join(Config.TMP_DIR, f"{call_id}.mp3")
        mono_path = os.path.join(Config.TMP_DIR, f"{call_id}_mono.wav")

        # Download audio from Supabase Storage
        logger.info(f'📥 Downloading from storage: {storage_path}')
        with open(local_path, 'wb') as f:
            audio_data = supabase.storage.from_('calls_audio').download(storage_path)
            f.write(audio_data)

        # Convert to mono 16kHz WAV
        logger.info('🔄 Converting to mono 16kHz WAV...')
        convert_audio(local_path, mono_path)

        # Transcribe (DEBUG MODE)
        transcript_text = transcribe_audio(mono_path)

        # Diarize
        transcript_segments = diarize_audio(mono_path)

        # Validate transcript
        if not transcript_text or len(transcript_text.strip()) < 10:
            logger.warning(f'⚠️ Call {call_id[:8]} has very short transcript ({len(transcript_text)} chars)')
            logger.warning(f'⚠️ This might indicate the extraction bug!')

        # Save to database
        logger.info(f'💾 Saving transcription results...')
        supabase.schema('core').from_('calls').update({
            'status': 'transcribed',
            'transcript_text': transcript_text,
            'transcript_segments': transcript_segments,
            'updated_at': datetime.utcnow().isoformat()
        }).eq('id', call_id).execute()

        logger.info(f"✅ Finished {call_id[:8]} ({len(transcript_text)} chars, {len(transcript_segments)} segments)")
        return True

    except subprocess.TimeoutExpired:
        logger.error(f"❌ FFmpeg timeout for call {call_id[:8]}")
        mark_failed(call_id, "Audio conversion timeout")
        return False

    except Exception as e:
        logger.error(f"❌ Error processing call {call_id[:8] if 'call_id' in locals() else 'unknown'}: {e}")
        if 'call_id' in locals():
            mark_failed(call_id, str(e))
        return False

    finally:
        # Cleanup temporary files
        for path in [local_path, mono_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except Exception as e:
                    logger.warning(f'⚠️ Failed to delete {path}: {e}')

        # Free GPU memory
        torch.cuda.empty_cache()
        gc.collect()

def mark_failed(call_id: str, error_msg: str) -> None:
    """Mark a call as failed with error message"""
    try:
        supabase.schema('core').from_('calls').update({
            'status': 'failed',
            'processing_error': error_msg,
            'updated_at': datetime.utcnow().isoformat()
        }).eq('id', call_id).execute()
        logger.info(f'📝 Marked {call_id[:8]} as failed')
    except Exception as e:
        logger.error(f'❌ Failed to mark call as failed: {e}')

# ============================================================================
# Main Loop
# ============================================================================

def main():
    """Main worker loop - runs forever"""
    logger.info("🚀 CallScript V2 DEBUG Worker Started")
    logger.info(f"📊 GPU: {torch.cuda.get_device_name(0)}")
    logger.info(f"💾 VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
    logger.info("🔍 DEBUG MODE: Extreme logging enabled")
    logger.info("⏳ Waiting for calls...")

    processed_count = 0

    while True:
        try:
            # Process one call
            did_work = process_call()

            if did_work:
                processed_count += 1

                # Log milestone every 10 calls
                if processed_count % 10 == 0:
                    logger.info(f"🎉 Milestone: {processed_count} calls processed")
            else:
                # No work found - sleep briefly
                time.sleep(1)

        except KeyboardInterrupt:
            logger.info("👋 Shutting down gracefully...")
            break

        except Exception as e:
            logger.error(f"⚠️ Unexpected error in main loop: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
