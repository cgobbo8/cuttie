from enum import Enum

from pydantic import BaseModel


class JobStatus(str, Enum):
    PENDING = "PENDING"
    DOWNLOADING_AUDIO = "DOWNLOADING_AUDIO"
    DOWNLOADING_CHAT = "DOWNLOADING_CHAT"
    ANALYZING_AUDIO = "ANALYZING_AUDIO"
    ANALYZING_CHAT = "ANALYZING_CHAT"
    SCORING = "SCORING"
    TRIAGE = "TRIAGE"
    CLIPPING = "CLIPPING"
    TRANSCRIBING = "TRANSCRIBING"
    LLM_ANALYSIS = "LLM_ANALYSIS"
    DONE = "DONE"
    ERROR = "ERROR"


class AudioCategoryGroup(BaseModel):
    """A named group of AudioSet class indices with per-class weights.

    Used to configure which audio events PANNs should listen for.
    Keys are AudioSet class indices (0-526), values are weights (0.0-1.0).
    """
    classes: dict[int, float]
    aggregation: str = "weighted_sum"  # "weighted_sum" or "max"


class ClassificationConfig(BaseModel):
    """Configuration for PANNs audio classification categories.

    Each group produces a score per window. The scorer then uses these
    scores with the boost factors defined in ScoringConfig.
    """
    speech: AudioCategoryGroup = AudioCategoryGroup(
        classes={0: 1.0, 1: 1.0, 2: 1.0},
        aggregation="max",
    )
    excitement: AudioCategoryGroup = AudioCategoryGroup(
        classes={
            8: 1.0, 10: 0.8, 11: 1.0, 12: 1.0, 14: 1.0,
            16: 1.0, 18: 0.8, 20: 1.0, 44: 0.7, 66: 0.9,
        },
        aggregation="weighted_sum",
    )
    game_audio: AudioCategoryGroup = AudioCategoryGroup(
        classes={
            137: 0.8, 287: 0.6, 426: 1.0, 427: 1.0,
            428: 0.9, 436: 0.8, 469: 0.7,
        },
        aggregation="weighted_sum",
    )
    extra_groups: dict[str, AudioCategoryGroup] = {}


class ScoringConfig(BaseModel):
    """Configuration for composite scoring weights and boost factors."""
    # Base signal weights (should sum to ~1.0)
    weights: dict[str, float] = {
        "rms": 0.18,
        "chat_speed": 0.18,
        "flux": 0.12,
        "onset": 0.10,
        "pitch_var": 0.10,
        "centroid": 0.05,
        "zcr": 0.02,
        "chat_burst": 0.10,
        "emote_density": 0.08,
        "caps_ratio": 0.07,
    }
    # Multiplicative boost factors for classification signals
    agreement_boost: float = 0.3       # audio+chat agreement (up to 1+X)
    sentiment_boost: float = 0.15      # chat sentiment intensity
    voice_energy_boost: float = 0.15   # speech * rms
    excitement_additive: float = 0.10  # rare vocal excitement (additive)
    game_dampening: float = 0.15       # game-only audio dampening
    # Extra group boosts: group_name -> (mode, factor)
    # mode: "additive" or "multiplicative"
    extra_group_boosts: dict[str, tuple[str, float]] = {}
    # Peak detection
    min_peak_distance_sec: float = 60.0
    smooth_sigma: float = 2.5
    top_n_candidates: int = 50
    top_n_keep: int = 20


class PipelineConfig(BaseModel):
    """Full pipeline configuration. All fields have sensible defaults
    matching the current behavior. Override selectively to customize.
    """
    classification: ClassificationConfig = ClassificationConfig()
    scoring: ScoringConfig = ScoringConfig()


class AnalyzeRequest(BaseModel):
    url: str
    config: PipelineConfig | None = None


class SignalBreakdown(BaseModel):
    rms: float = 0.0
    spectral_flux: float = 0.0
    pitch_variance: float = 0.0
    spectral_centroid: float = 0.0
    zcr: float = 0.0
    chat_speed: float = 0.0


class KeyMoment(BaseModel):
    time: float  # seconds into the clip
    label: str  # short title (5-8 words)
    description: str = ""  # what happens visually + contextually


class LlmAnalysis(BaseModel):
    transcript: str = ""
    speech_rate: float = 0.0  # words per second
    category: str = ""  # fun, rage, clutch, skill, fail, emotional, etc.
    virality_score: float = 0.0  # 0-1, LLM's assessment of viral potential
    summary: str = ""  # Short description of what happens
    is_clipable: bool = True  # Can this stand alone as a clip?
    key_moments: list[KeyMoment] = []  # Vision-based timeline of key moments
    narrative: str = ""  # Full narrative combining transcript + vision


class HotPoint(BaseModel):
    timestamp_seconds: float
    timestamp_display: str
    score: float  # heuristic score from audio/chat analysis
    final_score: float | None = None  # blended score after LLM (0.3 heuristic + 0.7 LLM)
    signals: SignalBreakdown
    chat_mood: str = ""  # pre-tag from chat sentiment: "hype", "fun", "rip", or ""
    clip_filename: str | None = None
    vertical_filename: str | None = None
    clip_name: str = ""  # short display name, LLM-generated then user-editable
    llm: LlmAnalysis | None = None


class StepTiming(BaseModel):
    start: float  # unix timestamp
    duration_seconds: float | None = None  # None while step is in progress


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: str | None = None
    hot_points: list[HotPoint] | None = None
    error: str | None = None
    vod_title: str | None = None
    vod_game: str | None = None
    vod_duration_seconds: float | None = None
    streamer: str | None = None
    view_count: int | None = None
    stream_date: str | None = None
    step_timings: dict[str, StepTiming] | None = None
