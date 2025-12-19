"""
CallScript V2 - Speaker-Text Alignment

Aligns transcript text with diarization segments to produce
speaker-attributed transcript segments.

Since word-level timestamps aren't available with beam decoding on RTX 3090,
we use a proportional distribution heuristic:
1. Calculate total speaking time from diarization
2. Distribute words across segments based on segment duration
3. Each segment gets proportional share of words

This is an approximation but provides reasonable results for most calls.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger("worker")


def align_transcript_with_speakers(
    transcript_text: str,
    diarization_segments: list[dict],
) -> list[dict]:
    """
    Align transcript text with speaker diarization segments.

    Uses proportional word distribution based on segment duration.
    Each output segment contains: {speaker, start, end, text}

    Args:
        transcript_text: Full transcript text from ASR
        diarization_segments: List of {speaker, start, end} from diarization

    Returns:
        List of segments with text added: [{speaker, start, end, text}, ...]
        Returns original segments (without text) if alignment fails.
    """
    if not transcript_text or not diarization_segments:
        logger.warning("Empty transcript or segments, returning original")
        return diarization_segments

    # Clean and split transcript into words
    words = _split_into_words(transcript_text)
    if not words:
        logger.warning("No words extracted from transcript")
        return diarization_segments

    # Calculate total speaking time
    total_duration = sum(
        max(0, seg.get("end", 0) - seg.get("start", 0))
        for seg in diarization_segments
    )

    if total_duration <= 0:
        logger.warning("Invalid total duration, returning original segments")
        return diarization_segments

    # Calculate words per second (for proportional distribution)
    words_per_second = len(words) / total_duration
    logger.debug(f"Alignment: {len(words)} words / {total_duration:.1f}s = {words_per_second:.2f} wps")

    # Distribute words to segments
    aligned_segments = []
    word_index = 0

    for seg in diarization_segments:
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        speaker = seg.get("speaker", "SPEAKER_00")
        duration = max(0, end - start)

        # Calculate how many words this segment should get
        word_count = round(duration * words_per_second)

        # Ensure we don't exceed remaining words
        word_count = min(word_count, len(words) - word_index)

        # Get words for this segment
        segment_words = words[word_index : word_index + word_count]
        segment_text = " ".join(segment_words)

        aligned_segments.append({
            "speaker": speaker,
            "start": round(start, 3),
            "end": round(end, 3),
            "text": segment_text,
        })

        word_index += word_count

    # Handle remaining words (add to last segment)
    if word_index < len(words) and aligned_segments:
        remaining = " ".join(words[word_index:])
        last_text = aligned_segments[-1].get("text", "")
        if last_text:
            aligned_segments[-1]["text"] = f"{last_text} {remaining}"
        else:
            aligned_segments[-1]["text"] = remaining
        logger.debug(f"Added {len(words) - word_index} remaining words to last segment")

    # Merge consecutive segments with same speaker for cleaner output
    merged_segments = _merge_same_speaker_segments(aligned_segments)

    logger.info(
        f"Aligned {len(words)} words across {len(merged_segments)} segments "
        f"(from {len(diarization_segments)} raw segments)"
    )

    return merged_segments


def _split_into_words(text: str) -> list[str]:
    """
    Split text into words, handling punctuation.

    Args:
        text: Input text

    Returns:
        List of words (preserving punctuation attached to words)
    """
    # Simple split on whitespace, preserving punctuation
    words = text.split()

    # Filter out empty strings and pure punctuation
    words = [w for w in words if w and not re.match(r'^[.,!?;:\'"()-]+$', w)]

    return words


def _merge_same_speaker_segments(segments: list[dict]) -> list[dict]:
    """
    Merge consecutive segments with the same speaker.

    This produces cleaner output by combining adjacent turns
    from the same speaker.

    Args:
        segments: List of aligned segments

    Returns:
        Merged segments where consecutive same-speaker segments are combined
    """
    if not segments:
        return []

    merged = []
    current = None

    for seg in segments:
        if current is None:
            current = seg.copy()
        elif seg.get("speaker") == current.get("speaker"):
            # Same speaker - extend current segment
            current["end"] = seg.get("end", current.get("end"))
            current_text = current.get("text", "")
            seg_text = seg.get("text", "")
            if current_text and seg_text:
                current["text"] = f"{current_text} {seg_text}"
            elif seg_text:
                current["text"] = seg_text
        else:
            # Different speaker - save current and start new
            merged.append(current)
            current = seg.copy()

    # Don't forget the last segment
    if current is not None:
        merged.append(current)

    return merged


def get_speaker_summary(segments: list[dict]) -> dict:
    """
    Generate a summary of speaker participation.

    Args:
        segments: Aligned segments with text

    Returns:
        Dict with speaker stats: {speaker: {duration, word_count, percentage}}
    """
    summary = {}

    total_duration = 0
    total_words = 0

    for seg in segments:
        speaker = seg.get("speaker", "SPEAKER_00")
        duration = max(0, seg.get("end", 0) - seg.get("start", 0))
        text = seg.get("text", "")
        word_count = len(text.split()) if text else 0

        if speaker not in summary:
            summary[speaker] = {"duration": 0, "word_count": 0}

        summary[speaker]["duration"] += duration
        summary[speaker]["word_count"] += word_count

        total_duration += duration
        total_words += word_count

    # Add percentages
    for speaker in summary:
        if total_duration > 0:
            summary[speaker]["percentage"] = round(
                summary[speaker]["duration"] / total_duration * 100, 1
            )
        else:
            summary[speaker]["percentage"] = 0

    return summary
