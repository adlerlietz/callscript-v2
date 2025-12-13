"""
CallScript V2 - Model Loading

Handles loading of ASR and diarization models with battle-tested configurations.

CRITICAL: The configurations in this file are locked to known working values.
DO NOT modify the decoding strategy or model parameters without extensive testing.
"""

import gc
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import torch
from omegaconf import OmegaConf

from .config import Settings

if TYPE_CHECKING:
    from nemo.collections.asr.models import ASRModel
    from pyannote.audio import Pipeline

logger = logging.getLogger("worker")

# =============================================================================
# CHUNKING CONFIGURATION
# =============================================================================
# Maximum audio duration (seconds) before chunking is triggered
MAX_AUDIO_DURATION_SECONDS = 600  # 10 minutes

# Chunk size for long audio files (seconds)
CHUNK_DURATION_SECONDS = 300  # 5 minutes

# Overlap between chunks to avoid cutting words (seconds)
CHUNK_OVERLAP_SECONDS = 5


def load_asr_model(settings: Settings) -> "ASRModel":
    """
    Load Parakeet TDT model with beam decoding.

    CRITICAL FIXES APPLIED:
    1. Uses ASRModel.from_pretrained() factory - NOT the specific model class
    2. Beam decoding (beam_size=1) - fixes CUDA graph failures on RTX 3090
    3. TDT-specific durations config for Token-and-Duration Transducer

    Args:
        settings: Application settings with model config

    Returns:
        Ready-to-use ASR model on CUDA

    Raises:
        RuntimeError: If model loading or configuration fails
    """
    import nemo.collections.asr as nemo_asr

    model_name = settings.asr_model
    logger.info(f"Loading ASR model: {model_name}")

    try:
        # =================================================================
        # CRITICAL FIX #1: Use ASRModel factory class
        # Using EncDecRNNTBPEModel directly causes empty transcripts
        # =================================================================
        model = nemo_asr.models.ASRModel.from_pretrained(model_name=model_name)
        model.cuda()
        model.eval()
        logger.info("ASR model loaded and moved to CUDA")

        # =================================================================
        # CRITICAL FIX #2: Beam decoding strategy
        # The default greedy_batch uses CUDA graphs which fail on RTX 3090
        # with "CUDA failure! 35" error. Beam decoding bypasses this.
        # =================================================================
        decoding_cfg = OmegaConf.create({
            "strategy": settings.decoding_strategy,
            "model_type": "tdt",
            # TDT-specific: duration buckets for Token-and-Duration Transducer
            "durations": [0, 1, 2, 3, 4],
            "beam": {
                "beam_size": settings.beam_size,
                "return_best_hypothesis": True,
                "score_norm": True,
                # TDT beam search parameters
                "tsd_max_sym_exp": 50,
                "alsd_max_target_len": 2.0,
            },
        })

        model.change_decoding_strategy(decoding_cfg)
        logger.info(
            f"Decoding strategy configured: {settings.decoding_strategy} "
            f"(beam_size={settings.beam_size})"
        )

        return model

    except Exception as e:
        logger.error(f"Failed to load ASR model '{model_name}': {e}")
        raise RuntimeError(f"ASR model loading failed: {e}") from e


def load_diarization_pipeline(settings: Settings) -> "Pipeline":
    """
    Load Pyannote speaker diarization pipeline.

    Args:
        settings: Application settings with HuggingFace token

    Returns:
        Ready-to-use diarization pipeline on CUDA

    Raises:
        RuntimeError: If pipeline loading fails
    """
    from pyannote.audio import Pipeline

    model_name = settings.diarization_model
    logger.info(f"Loading diarization pipeline: {model_name}")

    try:
        # =================================================================
        # NOTE: Pyannote 3.x uses 'token' parameter
        # The deprecated 'use_auth_token' will cause warnings/errors
        # =================================================================
        pipeline = Pipeline.from_pretrained(
            model_name,
            token=settings.hf_token,
        )
        pipeline.to(torch.device("cuda"))
        logger.info("Diarization pipeline loaded and moved to CUDA")

        return pipeline

    except Exception as e:
        logger.error(f"Failed to load diarization pipeline '{model_name}': {e}")
        raise RuntimeError(f"Diarization pipeline loading failed: {e}") from e


def verify_gpu_available() -> dict:
    """
    Verify CUDA GPU is available and return device info.

    Returns:
        Dict with GPU information

    Raises:
        RuntimeError: If no GPU available
    """
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU not available - cannot run worker")

    device_name = torch.cuda.get_device_name(0)
    memory_total = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    memory_allocated = torch.cuda.memory_allocated(0) / (1024**3)

    info = {
        "device": device_name,
        "memory_total_gb": round(memory_total, 2),
        "memory_allocated_gb": round(memory_allocated, 2),
        "cuda_version": torch.version.cuda,
    }

    logger.info(f"GPU verified: {device_name} ({memory_total:.1f}GB)")
    return info


# =============================================================================
# AUDIO UTILITIES
# =============================================================================

def get_audio_duration(audio_path: str) -> float:
    """
    Get duration of audio file in seconds using ffprobe.

    Args:
        audio_path: Path to audio file

    Returns:
        Duration in seconds
    """
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError) as e:
        logger.warning(f"Could not get audio duration: {e}")
        # Return 0 to skip chunking if we can't determine duration
        return 0.0


def split_audio_into_chunks(
    audio_path: str,
    chunk_duration: float = CHUNK_DURATION_SECONDS,
    overlap: float = CHUNK_OVERLAP_SECONDS,
) -> list[str]:
    """
    Split audio file into smaller chunks using ffmpeg.

    Args:
        audio_path: Path to source audio file
        chunk_duration: Duration of each chunk in seconds
        overlap: Overlap between chunks in seconds

    Returns:
        List of paths to chunk files (caller must clean up)
    """
    duration = get_audio_duration(audio_path)
    if duration <= 0:
        logger.warning("Could not determine audio duration, returning original file")
        return [audio_path]

    chunk_paths = []
    temp_dir = tempfile.mkdtemp(prefix="callscript_chunks_")

    start_time = 0.0
    chunk_index = 0
    step = chunk_duration - overlap  # How far to advance for each chunk

    while start_time < duration:
        chunk_path = os.path.join(temp_dir, f"chunk_{chunk_index:03d}.wav")

        # Calculate chunk end time
        end_time = min(start_time + chunk_duration, duration)
        chunk_length = end_time - start_time

        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i", audio_path,
                    "-ss", str(start_time),
                    "-t", str(chunk_length),
                    "-ac", "1",
                    "-ar", "16000",
                    chunk_path,
                ],
                check=True,
                capture_output=True,
            )
            chunk_paths.append(chunk_path)
            logger.debug(f"Created chunk {chunk_index}: {start_time:.1f}s - {end_time:.1f}s")
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to create chunk {chunk_index}: {e}")
            # Clean up any chunks created so far
            cleanup_chunk_files(chunk_paths, temp_dir)
            raise RuntimeError(f"Audio chunking failed: {e}")

        start_time += step
        chunk_index += 1

    logger.info(f"Split audio into {len(chunk_paths)} chunks ({chunk_duration}s each, {overlap}s overlap)")
    return chunk_paths


def cleanup_chunk_files(chunk_paths: list[str], temp_dir: str = None) -> None:
    """
    Remove temporary chunk files and directory.

    Args:
        chunk_paths: List of chunk file paths
        temp_dir: Temporary directory to remove (optional)
    """
    for path in chunk_paths:
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except OSError as e:
            logger.warning(f"Failed to remove chunk {path}: {e}")

    if temp_dir and os.path.exists(temp_dir):
        try:
            os.rmdir(temp_dir)
        except OSError:
            pass  # Directory not empty or other error


# =============================================================================
# TRANSCRIPTION
# =============================================================================

def _transcribe_single(model: "ASRModel", audio_path: str) -> str:
    """
    Transcribe a single audio file (internal function).

    Args:
        model: Loaded ASR model
        audio_path: Path to 16kHz mono WAV file

    Returns:
        Transcript text
    """
    # =================================================================
    # CRITICAL FIX #3: API parameters
    # - Use 'audio=' not 'paths2audio_files=' (NeMo 2.x API)
    # - Use return_hypotheses=True (required for TDT text extraction)
    # =================================================================
    hypotheses = model.transcribe(
        audio=[audio_path],
        return_hypotheses=True,
    )

    if not hypotheses or len(hypotheses) == 0:
        return ""

    hypothesis = hypotheses[0]

    # Handle different return types from various NeMo versions
    if hasattr(hypothesis, "text"):
        return hypothesis.text
    elif isinstance(hypothesis, str):
        return hypothesis
    else:
        return str(hypothesis)


def transcribe(model: "ASRModel", audio_path: str) -> str:
    """
    Transcribe audio file using loaded ASR model.

    For long audio files (>10 minutes), automatically splits into chunks
    to prevent CUDA OOM errors on RTX 3090.

    CRITICAL: Must use return_hypotheses=True for TDT models.
    The 'audio' parameter is the NeMo 2.x API (not 'paths2audio_files').

    Args:
        model: Loaded ASR model from load_asr_model()
        audio_path: Path to 16kHz mono WAV file

    Returns:
        Transcript text (may be empty for silent audio)
    """
    # Check audio duration
    duration = get_audio_duration(audio_path)

    # Short audio: transcribe directly
    if duration <= MAX_AUDIO_DURATION_SECONDS:
        logger.debug(f"Audio duration {duration:.1f}s <= {MAX_AUDIO_DURATION_SECONDS}s, transcribing directly")
        return _transcribe_single(model, audio_path)

    # Long audio: use chunking strategy
    logger.info(f"Long audio detected ({duration:.1f}s), using chunking strategy")

    chunk_paths = []
    temp_dir = None

    try:
        # Split into chunks
        chunk_paths = split_audio_into_chunks(
            audio_path,
            chunk_duration=CHUNK_DURATION_SECONDS,
            overlap=CHUNK_OVERLAP_SECONDS,
        )

        if chunk_paths:
            temp_dir = str(Path(chunk_paths[0]).parent)

        # Transcribe each chunk
        transcripts = []
        for i, chunk_path in enumerate(chunk_paths):
            logger.info(f"Transcribing chunk {i + 1}/{len(chunk_paths)}...")

            try:
                chunk_text = _transcribe_single(model, chunk_path)
                transcripts.append(chunk_text)
                logger.debug(f"Chunk {i + 1} transcribed: {len(chunk_text)} chars")
            except Exception as e:
                logger.error(f"Failed to transcribe chunk {i + 1}: {e}")
                transcripts.append("")  # Keep position for merge

            # CRITICAL: Clear VRAM between chunks to prevent accumulation
            torch.cuda.empty_cache()
            gc.collect()

        # Merge transcripts
        # Simple concatenation with space - overlap handles word boundaries
        merged = _merge_chunk_transcripts(transcripts)
        logger.info(f"Merged {len(chunk_paths)} chunks into {len(merged)} chars")

        return merged

    finally:
        # Always clean up chunk files
        if chunk_paths:
            cleanup_chunk_files(chunk_paths, temp_dir)
        torch.cuda.empty_cache()
        gc.collect()


def _merge_chunk_transcripts(transcripts: list[str]) -> str:
    """
    Merge chunked transcripts intelligently.

    Handles overlap by detecting and removing duplicate phrases
    at chunk boundaries.

    Args:
        transcripts: List of transcript strings from each chunk

    Returns:
        Merged transcript text
    """
    if not transcripts:
        return ""

    if len(transcripts) == 1:
        return transcripts[0].strip()

    merged_parts = []

    for i, transcript in enumerate(transcripts):
        text = transcript.strip()

        if not text:
            continue

        if i == 0:
            # First chunk: use as-is
            merged_parts.append(text)
        else:
            # Subsequent chunks: try to remove overlap
            text = _remove_overlap(merged_parts[-1] if merged_parts else "", text)
            if text:
                merged_parts.append(text)

    return " ".join(merged_parts)


def _remove_overlap(prev_text: str, current_text: str, max_overlap_words: int = 15) -> str:
    """
    Remove overlapping text at the boundary between chunks.

    Args:
        prev_text: Text from previous chunk
        current_text: Text from current chunk
        max_overlap_words: Maximum words to check for overlap

    Returns:
        Current text with overlap removed
    """
    if not prev_text or not current_text:
        return current_text

    # Get last N words from previous chunk
    prev_words = prev_text.split()[-max_overlap_words:]
    current_words = current_text.split()

    if not prev_words or not current_words:
        return current_text

    # Find longest matching suffix of prev in prefix of current
    best_overlap = 0

    for overlap_len in range(1, min(len(prev_words), len(current_words), max_overlap_words) + 1):
        # Check if last overlap_len words of prev match first overlap_len words of current
        prev_suffix = prev_words[-overlap_len:]
        current_prefix = current_words[:overlap_len]

        # Case-insensitive comparison
        if [w.lower() for w in prev_suffix] == [w.lower() for w in current_prefix]:
            best_overlap = overlap_len

    if best_overlap > 0:
        logger.debug(f"Removed {best_overlap} overlapping words at chunk boundary")
        return " ".join(current_words[best_overlap:])

    return current_text


# =============================================================================
# DIARIZATION
# =============================================================================

def diarize(pipeline: "Pipeline", audio_path: str) -> list[dict]:
    """
    Run speaker diarization on audio file.

    Handles both Pyannote 3.x and 4.x API differences.

    Args:
        pipeline: Loaded diarization pipeline
        audio_path: Path to audio file

    Returns:
        List of segments: [{"start": float, "end": float, "speaker": str}, ...]
    """
    result = pipeline(audio_path)
    segments = []

    # Pyannote 4.x returns DiarizeOutput with speaker_diarization attribute
    if hasattr(result, "speaker_diarization"):
        diarization = result.speaker_diarization
    else:
        diarization = result

    # Handle both old (itertracks) and new API
    if hasattr(diarization, "itertracks"):
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
                "speaker": str(speaker),
            })
    else:
        # Pyannote 4.x direct iteration
        for segment in diarization:
            segments.append({
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "speaker": str(getattr(segment, "speaker", "SPEAKER_00")),
            })

    return segments
