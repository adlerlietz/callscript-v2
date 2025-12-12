#!/usr/bin/env python3
"""
Factory Lane - CallScript V2
Transcribes and diarizes call audio using NeMo Parakeet TDT + Pyannote.
CRITICAL FIX: Uses ASRModel (not EncDecRNNTBPEModel) to load TDT model correctly.
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

logger.info('🚀 Loading NeMo Parakeet TDT ASR Model...')
try:
    # CRITICAL FIX: Use ASRModel (generic factory) to auto-detect EncDecTDTModel
    asr_model = nemo_asr.models.ASRModel.from_pretrained(
        model_name='nvidia/parakeet-tdt-0.6b-v2'
    )
    asr_model.cuda()
    asr_model.eval()
    logger.info(f'✅ Parakeet loaded successfully as {type(asr_model).__name__}')
except Exception as e:
    logger.critical(f'❌ Failed to load Parakeet: {e}')
    sys.exit(1)

logger.info('🗣️ Loading Pyannote Diarization Pipeline...')
try:
    # Try legacy parameter first for compatibility
    diarization_pipeline = Pipeline.from_pretrained(
        'pyannote/speaker-diarization-3.1',
        use_auth_token=Config.HF_TOKEN
    )
    diarization_pipeline.to(torch.device('cuda'))
    logger.info('✅ Pyannote loaded successfully')
except TypeError:
    # Retry with new parameter name if old one fails
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
# Signal Handlers (Graceful Shutdown)
# ============================================================================

def signal_handler(sig, frame):
    """Handle SIGTERM/SIGINT for graceful shutdown"""
    logger.info('🛑 Shutting down gracefully...')
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# ============================================================================
# Database Operations with Retry Logic
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
    Retries automatically on network errors.
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

    # Atomically lock the call by updating status
    lock_response = supabase.schema('core').from_('calls') \
        .update({'status': 'processing'}) \
        .eq('id', call['id']) \
        .eq('status', 'downloaded') \
        .execute()

    # Verify lock succeeded (row was updated)
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
# AI Inference
# ============================================================================

def transcribe_audio(audio_path: str) -> str:
    """
    Transcribe audio using NeMo Parakeet TDT.

    CRITICAL: Uses return_hypotheses=True for TDT models to extract text correctly.
    """
    logger.info(f'🎤 Transcribing with Parakeet TDT...')

    # TDT models require return_hypotheses=True for proper text extraction
    hypotheses = asr_model.transcribe(
        paths2audio_files=[audio_path],
        return_hypotheses=True
    )

    if not hypotheses or len(hypotheses) == 0:
        logger.warning('⚠️ Parakeet returned empty hypotheses')
        return ""

    # Extract text from Hypothesis object
    text = hypotheses[0].text if hasattr(hypotheses[0], 'text') else str(hypotheses[0])

    logger.info(f'✅ Transcribed {len(text)} characters')
    return text.strip()

def diarize_audio(audio_path: str) -> list:
    """
    Perform speaker diarization using Pyannote.
    Returns list of speaker segments with timestamps.

    For pyannote.audio 4.x: Returns DiarizeOutput, annotation at .speaker_diarization
    """
    logger.info('👥 Diarizing with Pyannote...')

    output = diarization_pipeline(audio_path)

    segments = []

    # Pyannote 4.x API: DiarizeOutput has .speaker_diarization attribute
    if hasattr(output, 'speaker_diarization'):
        logger.info('Using Pyannote 4.x API (DiarizeOutput.speaker_diarization)')
        for turn, speaker in output.speaker_diarization:
            segments.append({
                'start': float(turn.start),
                'end': float(turn.end),
                'speaker': speaker
            })
    # Pyannote 3.x API: Annotation with itertracks
    elif hasattr(output, 'itertracks'):
        logger.info('Using Pyannote 3.x API (Annotation.itertracks)')
        for segment, track, label in output.itertracks(yield_label=True):
            segments.append({
                'start': float(segment.start),
                'end': float(segment.end),
                'speaker': label
            })
    else:
        logger.error(f'Unknown Pyannote object type: {type(output)}')
        raise TypeError(f'Unsupported diarization output type: {type(output)}')

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

        # Transcribe (with return_hypotheses=True for TDT)
        transcript_text = transcribe_audio(mono_path)

        # Diarize
        transcript_segments = diarize_audio(mono_path)

        # Validate transcript (warn if empty but still save)
        if not transcript_text or len(transcript_text.strip()) < 10:
            logger.warning(f'⚠️ Call {call_id[:8]} has very short transcript ({len(transcript_text)} chars)')

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
        # Cleanup: Delete temporary files
        for path in [local_path, mono_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except Exception as e:
                    logger.warning(f'⚠️ Failed to delete {path}: {e}')

        # Critical: Free GPU memory after every call
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
    logger.info("🚀 CallScript V2 Factory Worker Started")
    logger.info(f"📊 GPU: {torch.cuda.get_device_name(0)}")
    logger.info(f"💾 VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
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
