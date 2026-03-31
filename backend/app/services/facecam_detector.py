"""Detect facecam overlay position using YOLOv8 pose estimation.

Strategy:
1. Run YOLOv8n-pose on sampled frames across multiple clips
2. Cluster person detections by center proximity
3. Pick the cluster spanning the most distinct clips (the facecam is static,
   game characters change between clips)
4. Compute tight face bounding box from facial keypoints (nose, eyes, ears)
"""

import logging

import cv2
import numpy as np
from ultralytics import YOLO

logger = logging.getLogger(__name__)

_model: YOLO | None = None

SAMPLE_POSITIONS = [0.2, 0.35, 0.5, 0.65, 0.8]
MIN_CONFIDENCE = 0.4
CLUSTER_DISTANCE_RATIO = 0.15

# YOLOv8 pose keypoint indices for face
KP_NOSE = 0
KP_LEFT_EYE = 1
KP_RIGHT_EYE = 2
KP_LEFT_EAR = 3
KP_RIGHT_EAR = 4
FACE_KP_INDICES = [KP_NOSE, KP_LEFT_EYE, KP_RIGHT_EYE, KP_LEFT_EAR, KP_RIGHT_EAR]
# Minimum keypoint confidence to be considered visible
KP_MIN_CONF = 0.5


def _get_model() -> YOLO:
    global _model
    if _model is None:
        _model = YOLO("yolov8n-pose.pt")
    return _model


# Detection tuple: (clip_idx, person_x, person_y, person_w, person_h, conf,
#                    face_x, face_y, face_w, face_h)
Detection = tuple[int, int, int, int, int, float, int, int, int, int]


def _face_bbox_from_keypoints(
    keypoints: np.ndarray,
) -> tuple[int, int, int, int] | None:
    """Compute tight face bbox from facial keypoints.

    keypoints shape: (17, 3) — x, y, confidence per keypoint.
    Returns (x, y, w, h) or None if not enough visible keypoints.
    """
    face_kps = keypoints[FACE_KP_INDICES]
    visible = face_kps[:, 2] > KP_MIN_CONF
    if visible.sum() < 2:
        return None

    pts = face_kps[visible, :2]
    x_min, y_min = pts.min(axis=0)
    x_max, y_max = pts.max(axis=0)

    # Expand to a square with margin around the keypoints
    cx = (x_min + x_max) / 2
    cy = (y_min + y_max) / 2
    span = max(x_max - x_min, y_max - y_min)
    # Face is roughly 1.6x the eye-to-ear span
    half = span * 0.8

    x = int(cx - half)
    y = int(cy - half)
    size = int(half * 2)
    return x, y, size, size


def _collect_detections(clip_paths: list[str]) -> tuple[list[Detection], int, int]:
    """Detect persons + face keypoints on sampled frames from multiple clips."""
    model = _get_model()
    detections: list[Detection] = []
    frame_w = frame_h = 0

    for clip_idx, clip_path in enumerate(clip_paths):
        cap = cv2.VideoCapture(clip_path)
        if not cap.isOpened():
            continue

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        for pos in SAMPLE_POSITIONS:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total_frames * pos))
            ret, frame = cap.read()
            if not ret:
                continue
            results = model(frame, conf=MIN_CONFIDENCE, verbose=False)

            for i, box in enumerate(results[0].boxes):
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                conf = float(box.conf[0])
                pw, ph = x2 - x1, y2 - y1

                # Extract face bbox from keypoints
                kps = results[0].keypoints.data[i].cpu().numpy()
                face = _face_bbox_from_keypoints(kps)
                if face is None:
                    continue
                fx, fy, fw, fh = face

                detections.append((clip_idx, x1, y1, pw, ph, conf, fx, fy, fw, fh))

        cap.release()

    return detections, frame_w, frame_h


def _cluster_detections(
    detections: list[Detection], merge_distance: float,
) -> list[list[Detection]]:
    """Group detections by person center proximity."""
    clusters: list[list[Detection]] = []
    for det in detections:
        _, px, py, pw, ph = det[0], det[1], det[2], det[3], det[4]
        cx, cy = px + pw // 2, py + ph // 2
        merged = False
        for cluster in clusters:
            avg_cx = np.mean([d[1] + d[3] // 2 for d in cluster])
            avg_cy = np.mean([d[2] + d[4] // 2 for d in cluster])
            if np.sqrt((cx - avg_cx) ** 2 + (cy - avg_cy) ** 2) < merge_distance:
                cluster.append(det)
                merged = True
                break
        if not merged:
            clusters.append([det])
    return clusters


def _pick_best_cluster(clusters: list[list[Detection]]) -> list[Detection]:
    """Pick the cluster most likely to be the facecam.

    Priority: most distinct clips > most detections > smaller average size.
    """
    def score(cluster: list[Detection]) -> tuple:
        n_clips = len(set(d[0] for d in cluster))
        n_dets = len(cluster)
        avg_area = np.mean([d[3] * d[4] for d in cluster])
        return (n_clips, n_dets, -avg_area)

    return max(clusters, key=score)


def detect_facecam(clip_path: str, extra_clips: list[str] | None = None) -> dict | None:
    """Detect the facecam face region using YOLOv8 pose estimation.

    Uses multiple clips for robustness. Person detections are clustered by
    position, and the cluster spanning the most distinct clips is selected.
    The face bounding box is computed from facial keypoints (nose, eyes, ears).

    Returns dict with keys: x, y, w, h (pixel coords in clip resolution)
    or None if no face found.
    """
    all_clips = [clip_path]
    if extra_clips:
        all_clips.extend(extra_clips)

    detections, frame_w, frame_h = _collect_detections(all_clips)

    if not detections:
        logger.info("No face detected in any clip")
        return None

    merge_dist = min(frame_w, frame_h) * CLUSTER_DISTANCE_RATIO
    clusters = _cluster_detections(detections, merge_dist)

    for i, cluster in enumerate(clusters):
        n_clips = len(set(d[0] for d in cluster))
        avg_fw = int(np.mean([d[8] for d in cluster]))
        avg_fh = int(np.mean([d[9] for d in cluster]))
        logger.debug(
            f"Cluster {i}: face {avg_fw}x{avg_fh}, "
            f"{len(cluster)} dets, {n_clips}/{len(all_clips)} clips"
        )

    best = _pick_best_cluster(clusters)
    n_clips = len(set(d[0] for d in best))

    # Use person bbox (the webcam overlay area), not the face bbox
    x = int(np.median([d[1] for d in best]))
    y = int(np.median([d[2] for d in best]))
    w = int(np.median([d[3] for d in best]))
    h = int(np.median([d[4] for d in best]))

    # Clamp to frame
    x = max(0, x)
    y = max(0, y)
    w = min(frame_w - x, w)
    h = min(frame_h - y, h)

    logger.info(
        f"Facecam region: ({x},{y}) {w}x{h} "
        f"[{len(best)} dets across {n_clips}/{len(all_clips)} clips]"
    )

    result = {"x": x, "y": y, "w": w, "h": h}
    return result
