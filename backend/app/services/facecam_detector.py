"""Detect facecam overlay position in a clip.

Strategy:
1. Detect face with MediaPipe → know where the webcam overlay is
2. Build persistent edge map (accumulate Canny edges over many frames)
3. Use HoughLinesP to find straight lines → overlay borders are persistent straight lines
4. Select border lines closest to the face in each direction
5. Snap to frame edge when close
"""

import logging
import os
import urllib.request

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

logger = logging.getLogger(__name__)

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
MODEL_PATH = os.path.join(os.path.expanduser("~"), ".cache", "mediapipe", "blaze_face_short_range.tflite")

# How many frames to sample
N_FRAMES_FACE = 5
N_FRAMES_EDGES = 20
FACE_SAMPLE_POSITIONS = [0.2, 0.35, 0.5, 0.65, 0.8]

# Edge persistence: keep edges present in > 50% of frames
EDGE_PERSISTENCE_RATIO = 0.5

# Snap to frame edge if within this fraction of frame dimension
SNAP_MARGIN = 0.08

# Hough line detection params
HOUGH_THRESHOLD = 30
HOUGH_MIN_LENGTH = 40
HOUGH_MAX_GAP = 10

# Max angle deviation (pixels) for a line to be horizontal/vertical
LINE_TOLERANCE = 5


def _ensure_model() -> str:
    if os.path.isfile(MODEL_PATH):
        return MODEL_PATH
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    logger.info("Downloading MediaPipe face detection model...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def _detect_face(clip_path: str) -> tuple[int, int, int, int, int, int] | None:
    """Detect face position (median across frames).
    Returns (fx, fy, fw, fh, frame_w, frame_h) or None.
    """
    model_path = _ensure_model()
    options = vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        min_detection_confidence=0.5,
    )
    detector = vision.FaceDetector.create_from_options(options)

    try:
        cap = cv2.VideoCapture(clip_path)
        if not cap.isOpened():
            return None

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        faces = []
        for pos in FACE_SAMPLE_POSITIONS:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total_frames * pos))
            ret, frame = cap.read()
            if not ret:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            results = detector.detect(image)
            if results.detections:
                b = results.detections[0].bounding_box
                faces.append((b.origin_x, b.origin_y, b.width, b.height))

        cap.release()

        if not faces:
            return None

        fx = int(np.median([f[0] for f in faces]))
        fy = int(np.median([f[1] for f in faces]))
        fw = int(np.median([f[2] for f in faces]))
        fh = int(np.median([f[3] for f in faces]))
        return fx, fy, fw, fh, frame_w, frame_h

    finally:
        detector.close()


def _build_persistent_edges(clip_path: str, frame_w: int, frame_h: int) -> np.ndarray:
    """Build a map of edges that persist across many frames (= structural elements like overlay borders)."""
    cap = cv2.VideoCapture(clip_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    edge_sum = np.zeros((frame_h, frame_w), dtype=np.float32)
    for i in range(N_FRAMES_EDGES):
        pos = int(total * (i + 1) / (N_FRAMES_EDGES + 1))
        cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
        ret, frame = cap.read()
        if ret:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray, 50, 150)
            edge_sum += edges.astype(np.float32)
    cap.release()

    threshold = N_FRAMES_EDGES * 255 * EDGE_PERSISTENCE_RATIO
    return ((edge_sum > threshold) * 255).astype(np.uint8)


def _find_overlay_rect(
    persistent: np.ndarray,
    fx: int, fy: int, fw: int, fh: int,
    frame_w: int, frame_h: int,
) -> tuple[int, int, int, int]:
    """Find the webcam overlay rectangle using Hough line detection on persistent edges.
    Returns (x, y, w, h).
    """
    lines = cv2.HoughLinesP(
        persistent, 1, np.pi / 180,
        threshold=HOUGH_THRESHOLD,
        minLineLength=HOUGH_MIN_LENGTH,
        maxLineGap=HOUGH_MAX_GAP,
    )

    face_cx = fx + fw // 2
    face_cy = fy + fh // 2

    # Classify lines as horizontal or vertical
    h_lines = []  # (y, x1, x2, length)
    v_lines = []  # (x, y1, y2, length)

    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)
            length = np.sqrt(dx**2 + dy**2)

            if dy <= LINE_TOLERANCE and dx > LINE_TOLERANCE:
                y_avg = (y1 + y2) // 2
                h_lines.append((y_avg, min(x1, x2), max(x1, x2), length))
            elif dx <= LINE_TOLERANCE and dy > LINE_TOLERANCE:
                x_avg = (x1 + x2) // 2
                v_lines.append((x_avg, min(y1, y2), max(y1, y2), length))

    # --- Find best border in each direction from face ---
    # Priority: longest line first (overlay borders span the full width/height),
    # then closest to face as tiebreaker.

    # LEFT: vertical line left of face → longest, then closest (highest x)
    left_edge = 0
    left_candidates = [v for v in v_lines if v[0] < fx]
    if left_candidates:
        left_candidates.sort(key=lambda v: (-v[3], -v[0]))
        left_edge = left_candidates[0][0]

    # RIGHT: vertical line right of face → longest, then closest (lowest x)
    right_edge = frame_w
    right_candidates = [v for v in v_lines if v[0] > fx + fw]
    if right_candidates:
        right_candidates.sort(key=lambda v: (-v[3], v[0]))
        right_edge = right_candidates[0][0]

    # TOP: horizontal line above face, overlapping face x-range → longest, then closest
    top_edge = 0
    top_candidates = [
        h for h in h_lines
        if h[0] < fy and h[2] > fx and h[1] < fx + fw
    ]
    if top_candidates:
        top_candidates.sort(key=lambda h: (-h[3], -h[0]))
        top_edge = top_candidates[0][0]

    # BOTTOM: horizontal line below face, overlapping face x-range → longest, then closest
    bottom_edge = frame_h
    bottom_candidates = [
        h for h in h_lines
        if h[0] > fy + fh and h[2] > fx and h[1] < fx + fw
    ]
    if bottom_candidates:
        bottom_candidates.sort(key=lambda h: (-h[3], h[0]))
        bottom_edge = bottom_candidates[0][0]

    # Snap to frame edge if close
    if left_edge < frame_w * SNAP_MARGIN:
        left_edge = 0
    if right_edge > frame_w * (1 - SNAP_MARGIN):
        right_edge = frame_w
    if top_edge < frame_h * SNAP_MARGIN:
        top_edge = 0
    if bottom_edge > frame_h * (1 - SNAP_MARGIN):
        bottom_edge = frame_h

    return left_edge, top_edge, right_edge - left_edge, bottom_edge - top_edge


def detect_facecam(clip_path: str) -> dict | None:
    """Detect the facecam overlay region in a clip.

    Returns dict with keys: x, y, w, h (pixel coords in clip resolution)
    or None if no face found.
    """
    face = _detect_face(clip_path)
    if face is None:
        logger.info(f"No face detected in {clip_path}")
        return None

    fx, fy, fw, fh, frame_w, frame_h = face
    logger.info(f"Face detected: ({fx},{fy}) {fw}x{fh} in {frame_w}x{frame_h}")

    persistent = _build_persistent_edges(clip_path, frame_w, frame_h)
    x, y, w, h = _find_overlay_rect(persistent, fx, fy, fw, fh, frame_w, frame_h)

    result = {"x": x, "y": y, "w": w, "h": h}
    logger.info(
        f"Facecam overlay detected: {w}x{h} at ({x},{y})"
    )
    return result
