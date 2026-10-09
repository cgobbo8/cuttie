"""Timestamped transcripts for the LLM (no heavy dependencies)."""

# A transcript line ends at a speaker change, a pause, or after this many words
LINE_MAX_WORDS = 14
LINE_PAUSE = 1.0


def format_labeled_transcript(labeled_words: list[dict]) -> str:
    """Format words (speaker-labeled or not) into a timestamped transcript for the LLM.

    A new line starts at each speaker change, pause or every few words, so the
    model can place moments to the second:
      [0.0s] Streamer: Hey chat, let's go
      [2.1s] SPEAKER_01: bro that was insane
    """
    if not labeled_words:
        return ""

    lines: list[str] = []
    current_words: list[str] = []
    current_speaker = None
    current_start = 0.0
    previous_end = None

    def flush() -> None:
        label = f"{current_speaker}: " if current_speaker else ""
        lines.append(f"[{current_start:.1f}s] {label}{' '.join(current_words)}")

    for w in labeled_words:
        spk = w.get("speaker")
        new_line = bool(current_words) and (
            spk != current_speaker
            or len(current_words) >= LINE_MAX_WORDS
            or (previous_end is not None and w["start"] - previous_end > LINE_PAUSE)
        )
        if new_line:
            flush()
            current_words = []
        if not current_words:
            current_speaker = spk
            current_start = w["start"]
        current_words.append(w["word"])
        previous_end = w.get("end", w["start"])

    if current_words:
        flush()
    return "\n".join(lines)


def format_segments(segments: list[tuple[float, float, str]]) -> str:
    """Timestamped lines from Whisper segments, when there are no word timings:
      [0.0s] Ok, pour la suite de grade.
    """
    return "\n".join(f"[{start:.1f}s] {text.strip()}" for start, _end, text in segments if text.strip())
