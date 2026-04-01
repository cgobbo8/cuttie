from enum import Enum

from pydantic import BaseModel


class JobStatus(str, Enum):
    PENDING = "PENDING"
    DOWNLOADING_AUDIO = "DOWNLOADING_AUDIO"
    DOWNLOADING_CHAT = "DOWNLOADING_CHAT"
    ANALYZING_AUDIO = "ANALYZING_AUDIO"
    ANALYZING_CHAT = "ANALYZING_CHAT"
    SCORING = "SCORING"
    ANALYZING_CLIPS = "ANALYZING_CLIPS"
    CLIPPING = "CLIPPING"
    LLM_ANALYSIS = "LLM_ANALYSIS"
    DONE = "DONE"
    ERROR = "ERROR"


class AnalyzeRequest(BaseModel):
    url: str


class SignalBreakdown(BaseModel):
    rms: float = 0.0
    spectral_flux: float = 0.0
    pitch_variance: float = 0.0
    spectral_centroid: float = 0.0
    zcr: float = 0.0
    chat_speed: float = 0.0
    vocal_excitement: float = 0.0
    speech_presence: float = 0.0


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
    final_score: float | None = None  # blended score after LLM (0.4 heuristic + 0.6 LLM)
    signals: SignalBreakdown
    chat_mood: str = ""  # pre-tag from chat sentiment: "hype", "fun", "rip", or ""
    clip_filename: str | None = None
    vertical_filename: str | None = None
    clip_name: str = ""  # short display name, LLM-generated then user-editable
    clip_source: str = "auto"  # "auto" (pipeline-generated) or "manual" (user-imported)
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
