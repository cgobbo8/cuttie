"""Find the webcam overlay on a stream with YOLOv8 pose estimation.

Strategy:
1. Run YOLOv8n-pose on frames sampled across several clips (or across a VOD)
2. Cluster person detections by center proximity
3. Pick the cluster spanning the most distinct sources (the facecam is static,
   game characters change between clips)
4. Grow the person box to the overlay's borders (see _snap_to_overlay)

Every person seen is also kept per source, so callers can tell whether the cam
is on screen in a given clip (scene without cam, streamer away...).
"""

import logging
import os
from collections.abc import Iterable
from dataclasses import dataclass, field

import cv2
import numpy as np
from ultralytics import YOLO

from app.services.paths import BACKEND_DIR

logger = logging.getLogger(__name__)

_model: YOLO | None = None

SAMPLE_POSITIONS = [0.2, 0.35, 0.5, 0.65, 0.8]
# Fewer frames per clip when checking a whole analysis (20+ clips)
MANY_CLIPS = 8
MANY_CLIPS_POSITIONS = [0.15, 0.4, 0.65, 0.9]
MIN_CONFIDENCE = 0.4
CLUSTER_DISTANCE_RATIO = 0.15
# Edge maps for overlay snapping are computed at 1/EDGE_SCALE resolution
EDGE_SCALE = 2
# Frames stacked for overlay snapping (each costs a few MB per intermediate array)
MAX_SNAP_FRAMES = 24

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
        _model = YOLO(os.path.join(BACKEND_DIR, "yolov8n-pose.pt"))
    return _model


# Detection tuple: (source_idx, person_x, person_y, person_w, person_h, conf,
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


@dataclass
class _Scan:
    """What the pose model saw on the sampled frames."""

    n_sources: int
    detections: list[Detection] = field(default_factory=list)
    # Center of every person seen, per source (an empty list = scanned, nobody)
    people: dict[int, list[tuple[int, int]]] = field(default_factory=dict)
    # Grayscale copies at 1/EDGE_SCALE, for overlay snapping
    gray_frames: list[np.ndarray] = field(default_factory=list)
    frame_w: int = 0
    frame_h: int = 0


def _clip_frames(clip_paths: list[str], positions: list[float]) -> Iterable[tuple[int, np.ndarray]]:
    """(clip index, BGR frame) at the given relative positions of each clip."""
    for clip_idx, clip_path in enumerate(clip_paths):
        cap = cv2.VideoCapture(clip_path)
        if not cap.isOpened():
            continue
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        for pos in positions:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total_frames * pos))
            ret, frame = cap.read()
            if ret:
                yield clip_idx, frame
        cap.release()


def _scan(frames: Iterable[tuple[int, np.ndarray]], n_sources: int) -> _Scan:
    """Run the pose model on each frame; only small grayscale copies are kept."""
    model = _get_model()
    scan = _Scan(n_sources=n_sources)

    for source, frame in frames:
        scan.frame_h, scan.frame_w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        scan.gray_frames.append(
            cv2.resize(gray, (scan.frame_w // EDGE_SCALE, scan.frame_h // EDGE_SCALE), interpolation=cv2.INTER_AREA)
        )
        people = scan.people.setdefault(source, [])
        results = model(frame, conf=MIN_CONFIDENCE, verbose=False)

        for i, box in enumerate(results[0].boxes):
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
            conf = float(box.conf[0])
            pw, ph = int(x2 - x1), int(y2 - y1)

            # Extract face bbox from keypoints
            kps = results[0].keypoints.data[i].cpu().numpy()
            face = _face_bbox_from_keypoints(kps)
            if face is None:
                people.append((int(x1 + pw // 2), int(y1 + ph // 2)))
                continue
            fx, fy, fw, fh = face
            # Where the face is: the streamer's body can line up with a game
            # character's below the cam and come out as one tall person
            people.append((int(fx + fw // 2), int(fy + fh // 2)))
            scan.detections.append((source, int(x1), int(y1), pw, ph, conf, fx, fy, fw, fh))

    return scan


def _static_edges(frames: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Horizontal / vertical gradient magnitudes present in (nearly) every frame.

    The webcam overlay's borders sit at the same place in every frame of every
    clip, while game content moves: a low percentile across frames keeps the
    former and wipes out the latter.
    """
    gx = np.stack([np.abs(cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=3)) for f in frames])
    gy = np.stack([np.abs(cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=3)) for f in frames])
    q = 25 if len(frames) >= 8 else 0
    return np.percentile(gx, q, axis=0), np.percentile(gy, q, axis=0)


def _strongest_line(profile: np.ndarray, lo: float, hi: float) -> int | None:
    """Index of the strongest line in profile[lo:hi], if it clearly stands out."""
    # Skip the outer pixels: Sobel's border handling creates fake edges there
    lo, hi = max(2, int(lo)), min(len(profile) - 2, int(hi))
    if hi - lo < 3:
        return None
    seg = profile[lo:hi]
    i = int(np.argmax(seg))
    if seg[i] < 10 or seg[i] < 3.0 * (float(np.median(seg)) + 1.0):
        return None
    return lo + i


def _scan_border(moving: np.ndarray, start: int, step: int, limit: int, threshold: float) -> int:
    """Walk from `start` (inside the cam) outwards and return the first index
    that moves like game footage, or where the walk ended (frame edge or limit)
    when everything up to there is static.

    The border is the split that best separates static pixels (inside) from
    moving ones (outside), so a band of motion right at the start (the
    streamer's head moving between frames, lighting changing over a long
    live) doesn't stop the walk early.
    """
    samples: list[int] = []
    i = start
    for _ in range(limit):
        if i < 0 or i >= len(moving):
            break
        samples.append(i)
        i += step
    end = min(max(i, 0), len(moving))
    if not samples:
        return end

    is_moving = np.array([moving[j] > threshold for j in samples])
    # Cost of putting the border after k samples: moving samples kept inside
    # plus static samples left outside (k = 0..n)
    inside_moving = np.concatenate([[0], np.cumsum(is_moving)])
    outside_static = np.concatenate([np.cumsum(~is_moving[::-1])[::-1], [0]])
    k = int(np.argmin(inside_moving + outside_static))
    return samples[k] if k < len(samples) else end


def _snap_to_overlay(
    frames: list[np.ndarray], box: tuple[int, int, int, int], frame_w: int, frame_h: int,
) -> tuple[int, int, int, int]:
    """Grow the person box to the webcam overlay's actual borders.

    The pose model frames the person (hair to shoulders), not the overlay: on a
    top-right cam the box typically starts ~90 px below the frame edge.

    Frames come from several clips, so game footage changes a lot from one to
    the next while the streamer's room stays put. From each side of the person
    box we walk outwards until pixels start changing like game footage (that's
    the overlay border), or hit the frame edge (the cam touches it). The border
    is then refined to the nearest static edge for pixel precision.
    """
    if len(frames) < 3:
        return box

    stack = np.stack(frames).astype(np.float32)
    # Median deviation rather than std: the streamer's head passing over a spot
    # in a few frames must not make their room look like game footage
    moving = np.median(np.abs(stack - np.median(stack, axis=0)), axis=0)
    gx, gy = _static_edges(frames)
    H, W = moving.shape
    s = frame_w / W
    x, y, w, h = (v / s for v in box)

    # How much game footage typically moves: everything far from the person
    far = np.ones((H, W), dtype=bool)
    far[int(max(0, y - h)):int(min(H, y + 2 * h)), int(max(0, x - w)):int(min(W, x + 2 * w))] = False
    game_level = float(np.median(moving[far])) if far.any() else float(np.median(moving))
    threshold = 0.5 * game_level

    # Profiles across the box's inner band (rounded corners and the person's own
    # motion at the edges would blur the transition)
    c0, c1 = int(max(0, x + 0.2 * w)), int(min(W, x + 0.8 * w))
    r0, r1 = int(max(0, y + 0.2 * h)), int(min(H, y + 0.8 * h))
    row_moving = moving[:, c0:c1].mean(axis=1)
    col_moving = moving[r0:r1, :].mean(axis=0)
    row_edges = gy[:, c0:c1].mean(axis=1)
    col_edges = gx[r0:r1, :].mean(axis=0)

    def refine(edges: np.ndarray, coarse: int, at_edge: bool) -> int:
        if at_edge:
            return coarse
        line = _strongest_line(edges, coarse - 8, coarse + 9)
        return line if line is not None else coarse

    lim_x, lim_y = int(0.9 * w), int(0.9 * h)
    left = _scan_border(col_moving, int(x), -1, lim_x, threshold)
    right = _scan_border(col_moving, int(x + w), 1, lim_x, threshold)
    top = _scan_border(row_moving, int(y), -1, lim_y, threshold)
    bottom = _scan_border(row_moving, int(y + h), 1, lim_y, threshold)

    # The moving pixel is outside the cam: the border sits just inside it
    left = refine(col_edges, left + 1, left <= 0) if left > 0 else 0
    right = refine(col_edges, right, right >= W) if right < W else W
    top = refine(row_edges, top + 1, top <= 0) if top > 0 else 0
    bottom = refine(row_edges, bottom, bottom >= H) if bottom < H else H
    # A border a few pixels from the frame edge is the frame edge (encoder noise)
    snap_x, snap_y = max(2, W // 100), max(2, H // 100)
    left = 0 if left <= snap_x else left
    top = 0 if top <= snap_y else top
    right = W if right >= W - snap_x else right
    bottom = H if bottom >= H - snap_y else bottom

    nx, ny = round(left * s), round(top * s)
    nw, nh = round((right - left) * s), round((bottom - top) * s)
    # Only accept a plausible overlay: it must still contain most of the person
    if nw < 0.6 * box[2] or nh < 0.6 * box[3] or nw * nh > 0.6 * frame_w * frame_h:
        return box
    return nx, ny, nw, nh


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


def _pick_best_cluster(
    clusters: list[list[Detection]], total_clips: int,
) -> list[Detection] | None:
    """Pick the cluster most likely to be the facecam.

    A real facecam is:
    - Present in MOST clips (it's a static overlay)
    - Consistent in size (doesn't grow/shrink between clips)
    - Relatively small (facecam, not the whole frame)

    Returns None if no cluster passes validation.
    """
    # Minimum: must appear in at least half the clips (and at least 2)
    min_clips = max(2, (total_clips + 1) // 2)

    def score(cluster: list[Detection]) -> tuple:
        n_clips = len(set(d[0] for d in cluster))
        n_dets = len(cluster)
        avg_area = np.mean([d[3] * d[4] for d in cluster])
        return (n_clips, n_dets, -avg_area)

    def is_size_stable(cluster: list[Detection]) -> bool:
        """Reject clusters where bbox size varies too much (game characters move, webcam doesn't)."""
        widths = [d[3] for d in cluster]
        heights = [d[4] for d in cluster]
        if len(widths) < 2:
            return True
        w_std = np.std(widths) / (np.mean(widths) + 1)
        h_std = np.std(heights) / (np.mean(heights) + 1)
        # Real facecam size varies <20%, game characters vary much more
        return w_std < 0.25 and h_std < 0.25

    # Filter: enough clips + stable size
    valid = [
        c for c in clusters
        if len(set(d[0] for d in c)) >= min_clips and is_size_stable(c)
    ]

    if not valid:
        logger.info(
            f"No cluster passed validation (need {min_clips}/{total_clips} clips + stable size). "
            f"Clusters: {[(len(set(d[0] for d in c)), len(c)) for c in clusters]}"
        )
        return None

    return max(valid, key=score)


def _same_lighting(frames: list[np.ndarray], box: tuple[int, int, int, int], frame_w: int) -> list[np.ndarray]:
    """The largest group of frames where the cam is lit about the same way.

    Over a long live the room's lighting changes (lamps, daylight, the
    camera's auto exposure), which makes the room look like moving game
    footage to _snap_to_overlay. Falls back to every frame when no group is
    big enough.
    """
    if not frames:
        return frames
    s = frame_w / frames[0].shape[1]
    x, y, w, h = (max(0, int(v / s)) for v in box)
    levels = np.array([float(f[y:y + h, x:x + w].mean()) for f in frames])

    def group(ref: float) -> np.ndarray:
        return np.abs(levels - ref) <= 0.12 * ref + 4

    best = max(levels, key=lambda ref: int(group(ref).sum()))
    keep = group(best)
    return [f for f, k in zip(frames, keep) if k] if keep.sum() >= 8 else frames


def _locate(scan: _Scan) -> tuple[int, int, int, int] | None:
    """The webcam overlay (x, y, w, h), or None when no consistent cam was seen."""
    if not scan.detections:
        logger.info("No face detected on any frame")
        return None

    merge_dist = min(scan.frame_w, scan.frame_h) * CLUSTER_DISTANCE_RATIO
    clusters = _cluster_detections(scan.detections, merge_dist)
    for i, cluster in enumerate(clusters):
        logger.debug(
            f"Cluster {i}: face {int(np.mean([d[8] for d in cluster]))}x{int(np.mean([d[9] for d in cluster]))}, "
            f"{len(cluster)} dets, {len(set(d[0] for d in cluster))}/{scan.n_sources} sources"
        )

    best = _pick_best_cluster(clusters, scan.n_sources)
    if best is None:
        logger.info("No consistent facecam detected (likely no webcam overlay)")
        return None

    # Use person bbox (the webcam overlay area), not the face bbox
    x = max(0, int(np.median([d[1] for d in best])))
    y = max(0, int(np.median([d[2] for d in best])))
    w = min(scan.frame_w - x, int(np.median([d[3] for d in best])))
    h = min(scan.frame_h - y, int(np.median([d[4] for d in best])))
    person = (x, y, w, h)

    frames = _same_lighting(scan.gray_frames, person, scan.frame_w)
    if len(frames) > MAX_SNAP_FRAMES:
        step = len(frames) / MAX_SNAP_FRAMES
        frames = [frames[int(i * step)] for i in range(MAX_SNAP_FRAMES)]
    rect = _snap_to_overlay(frames, person, scan.frame_w, scan.frame_h)

    logger.info(
        f"Facecam region: {rect} (person box {person}) "
        f"[{len(best)} dets across {len(set(d[0] for d in best))}/{scan.n_sources} sources]"
    )
    return rect


def _as_dict(rect: tuple[int, int, int, int] | None) -> dict | None:
    return dict(zip(("x", "y", "w", "h"), (int(v) for v in rect))) if rect else None


def detect_facecam(clip_path: str, extra_clips: list[str] | None = None) -> dict | None:
    """Webcam region over a few clips: {x, y, w, h} in clip pixels, or None."""
    clips = [clip_path, *(extra_clips or [])]
    return _as_dict(_locate(_scan(_clip_frames(clips, SAMPLE_POSITIONS), len(clips))))


def analyze_clips(clip_paths: list[str]) -> dict:
    """Webcam of a whole analysis.

    Returns {"rect": {x, y, w, h} | None, "frame_w", "frame_h", "people"}, where
    `people` lists, per clip filename, the centers of the persons seen on its
    sampled frames: the API uses them to tell whether the cam shows in a clip.
    """
    positions = MANY_CLIPS_POSITIONS if len(clip_paths) >= MANY_CLIPS else SAMPLE_POSITIONS
    scan = _scan(_clip_frames(clip_paths, positions), len(clip_paths))
    return {
        "rect": _as_dict(_locate(scan)),
        "frame_w": scan.frame_w,
        "frame_h": scan.frame_h,
        "people": {
            os.path.basename(clip_paths[i]): [list(p) for p in centers] for i, centers in sorted(scan.people.items())
        },
    }


def analyze_frames(frames: list[np.ndarray]) -> tuple[dict | None, int]:
    """Webcam on frames taken across a VOD (each frame is its own source).

    Returns the rectangle (or None) and the index of the frame to show the
    streamer: the one closest to the middle with somebody inside the cam.
    """
    scan = _scan(enumerate(frames), len(frames))
    rect = _locate(scan)
    middle = len(frames) // 2
    if not rect:
        return None, middle

    x, y, w, h = rect
    order = sorted(range(len(frames)), key=lambda i: abs(i - middle))
    shown = next(
        (i for i in order if any(x <= px <= x + w and y <= py <= y + h for px, py in scan.people.get(i, []))),
        middle,
    )
    return _as_dict(rect), shown
