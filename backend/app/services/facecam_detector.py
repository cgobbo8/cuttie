"""Detect facecam position in a clip using MediaPipe face detection.

Strategy:
1. Sample multiple frames from the clip
2. Run face detection on each, take median position (consensus)
3. Estimate facecam region: face × 2.0, snapped to nearest corner
4. Result is stable across frames since facecam is fixed overlay
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

# Facecam size relative to face size
FACECAM_RATIO = 2.0

# How many frames to sample for consensus
SAMPLE_POSITIONS = [0.2, 0.35, 0.5, 0.65, 0.8]


def _ensure_model() -> str:
    if os.path.isfile(MODEL_PATH):
        return MODEL_PATH
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    logger.info("Downloading MediaPipe face detection model...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def detect_facecam(clip_path: str) -> dict | None:
    """Detect the facecam region in a clip.

    Returns dict with keys: x, y, w, h (pixel coords in clip resolution)
    or None if no face found.
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
            logger.warning(f"Cannot open clip: {clip_path}")
            return None

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))

        # Sample frames and detect faces
        faces = []
        for pos in SAMPLE_POSITIONS:
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
            logger.info(f"No face detected in {clip_path}")
            return None

        # Consensus: median across frames
        fx = int(np.median([f[0] for f in faces]))
        fy = int(np.median([f[1] for f in faces]))
        fw = int(np.median([f[2] for f in faces]))
        fh = int(np.median([f[3] for f in faces]))
        face_cx = fx + fw // 2
        face_cy = fy + fh // 2

        # Facecam region: square, face × FACECAM_RATIO
        cam_size = int(fw * FACECAM_RATIO)

        # Snap horizontally to nearest edge
        if face_cx > frame_w / 2:
            cam_x2 = frame_w
            cam_x1 = frame_w - cam_size
        else:
            cam_x1 = 0
            cam_x2 = cam_size

        # Center vertically on face, clamp to frame
        cam_y1 = face_cy - cam_size // 2
        cam_y2 = cam_y1 + cam_size
        if cam_y2 > frame_h:
            cam_y1 -= cam_y2 - frame_h
            cam_y2 = frame_h
        if cam_y1 < 0:
            cam_y2 += -cam_y1
            cam_y1 = 0

        cam_x1 = max(0, int(cam_x1))
        cam_y1 = max(0, int(cam_y1))
        cam_x2 = min(frame_w, int(cam_x2))
        cam_y2 = min(frame_h, int(cam_y2))

        result = {
            "x": cam_x1,
            "y": cam_y1,
            "w": cam_x2 - cam_x1,
            "h": cam_y2 - cam_y1,
        }
        logger.info(
            f"Facecam detected: {result['w']}x{result['h']} at ({result['x']},{result['y']}) "
            f"[{len(faces)}/{len(SAMPLE_POSITIONS)} frames]"
        )
        return result

    finally:
        detector.close()
