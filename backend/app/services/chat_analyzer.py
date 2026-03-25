"""Chat speed analysis — counts messages per time window."""

import numpy as np


def analyze_chat(
    messages: list[dict],
    total_duration: float,
    window_sec: float = 5.0,
    hop_sec: float = 2.5,
) -> list[dict]:
    """Compute chat message density per time window.

    Returns a list of dicts with 'time' and 'chat_speed' keys,
    aligned to the same time grid as the audio analyzer.
    """
    if not messages or total_duration <= 0:
        return []

    timestamps = np.array([m["timestamp"] for m in messages])

    # Build windows matching audio analyzer's grid
    windows = []
    t = 0.0
    while t + window_sec <= total_duration:
        # Count messages in this window
        mask = (timestamps >= t) & (timestamps < t + window_sec)
        count = int(np.sum(mask))

        windows.append({
            "time": t,
            "chat_speed": count / window_sec,  # messages per second
        })
        t += hop_sec

    return windows
