"""The AI reading the whole live: what it's shown, and how its answer is read."""

import json

from app.services.presort import chat_highlights, parse_moments, transcript_lines
from app.services.vod_transcript import VodTranscript


def test_shows_the_live_as_timestamped_lines_of_about_20_seconds():
    tr = VodTranscript(segments=[(0.0, 2.0, " Bon"), (5.0, 7.0, " on y va"), (21.0, 23.0, " attention"), (3601.0, 3603.0, " une heure")])
    assert transcript_lines(tr) == ["[0:00:00] Bon on y va", "[0:00:21] attention", "[1:00:01] une heure"]


def test_points_at_chat_peaks_and_clip_requests_moved_onto_the_stream():
    quiet = [{"timestamp": 60.0 * m + 30, "text": "salut", "author": "a"} for m in range(10)]
    burst = [{"timestamp": 605.0 + i, "text": "MDR", "author": f"v{i}"} for i in range(8)]
    asks = [{"timestamp": 905.0, "text": "clip ça", "author": "v1"}, {"timestamp": 910.0, "text": "!clip", "author": "streamelements"}]
    lines = chat_highlights(quiet + burst + asks, lag=5.0)
    assert lines[0].startswith("[0:10:00] 8 chat messages")
    assert lines[-1] == '[0:15:00] a viewer asks for a clip: "clip ça"'
    assert not any("streamelements" in line.lower() for line in lines)


def test_reads_the_answer_into_valid_moments():
    answer = {
        "moments": [
            {"start": "1:00:00", "end": "1:00:40", "score": 90, "why": "chute"},
            {"start": "1:00:10", "end": "1:00:50", "score": 60, "why": "même moment"},  # overlaps the first
            {"start": "2:00:00", "end": "2:00:05", "score": 70, "why": "trop court"},  # widened
            {"start": "nope", "end": "2:10:00", "score": 80},
            {"start": "7:59:30", "end": "8:10:00", "score": 50, "why": "après la fin"},  # clipped to the live
        ]
    }
    moments = parse_moments("```json\n" + json.dumps(answer) + "\n```", duration=8 * 3600)
    assert [(m.start, m.end, m.score) for m in moments] == [(3600.0, 3640.0, 0.9), (7187.5, 7217.5, 0.7), (28770.0, 28800.0, 0.5)]


def test_keeps_places_for_the_ai_picks():
    from app.services.llm_analyzer import _pick_for_llm

    ranked = list(range(100))  # blended order
    # The AI's picks the blended score left out get their places; the others are already in
    chosen = _pick_for_llm(ranked, presort_picks=[3, 90, 91, 95], keep=10, slots=3)
    assert chosen == [0, 1, 2, 3, 4, 5, 6, 90, 91, 95][:7] + [90, 91, 95]
    assert len(chosen) == 10
    # Without picks: the blended order alone
    assert _pick_for_llm(ranked, [], keep=10, slots=3) == list(range(10))
    # Spare places go back to the blended order
    assert _pick_for_llm(ranked, [1, 2], keep=10, slots=3) == list(range(10))


def test_gives_moments_room_for_the_reaction():
    from app.services.presort import PresortMoment, window

    # A viewer clipped 3:16:34-3:17:04, the AI pointed at 3:15:59-3:16:45 (the fall, not the laughs after)
    start, end = window(PresortMoment(11759.0, 11805.0, 0.95, "hélices"), duration=27368.0)
    assert (start, end) == (11749.0, 11825.0)
    assert window(PresortMoment(5.0, 30.0, 0.5, ""), duration=40.0) == (0.0, 40.0)


def test_the_ai_picks_reach_the_llm_with_room_for_the_reaction(monkeypatch, tmp_path):
    """analyze_candidates with every paid call stubbed: the AI's moments join the candidates."""
    from app.models.schemas import HotPoint, LlmAnalysis, SignalBreakdown, VodContext
    from app.services import llm_analyzer, presort as presort_module, timeline
    from app.services.presort import PresortMoment

    monkeypatch.setattr(llm_analyzer, "work_dir", lambda *parts: str(tmp_path.joinpath(*parts)))
    for name in ("update_job", "add_notice", "save_hot_points"):
        monkeypatch.setattr(llm_analyzer, name, lambda *a, **k: None)
    monkeypatch.setattr(timeline, "publish", lambda *a, **k: None)
    monkeypatch.setattr(timeline, "publish_candidate", lambda *a, **k: None)
    monkeypatch.setattr(llm_analyzer, "get_vod_direct_url", lambda *a, **k: "")
    monkeypatch.setattr(llm_analyzer, "extract_frames_from_url", lambda *a, **k: [])
    monkeypatch.setattr(llm_analyzer, "gather_vod_context", lambda *a, **k: (VodContext(), {}))
    monkeypatch.setattr(llm_analyzer, "_call_unified_llm", lambda *a, **k: (LlmAnalysis(virality_score=0.5), "Test"))
    monkeypatch.setattr(llm_analyzer, "KEEP_NORMAL_FOR_LLM", 3)
    monkeypatch.setattr(llm_analyzer, "PRESORT_SLOTS", 2)
    sent: list[list[tuple[float, float]]] = []
    original = llm_analyzer._pick_for_llm

    def spy(ranked, picks, *a, **k):
        chosen = original(ranked, picks, keep=3, slots=2)
        sent.append([(hot_points[i].clip_start, hot_points[i].clip_end) for i in chosen])
        return chosen

    monkeypatch.setattr(llm_analyzer, "_pick_for_llm", spy)
    # Heuristic candidates: loud moments; one ends before the reaction viewers clipped (1000-1060 then 1060-1090)
    windows = [(100, 160, 0.9), (2000, 2060, 0.8), (3000, 3060, 0.7), (1000, 1060, 0.2)]
    hot_points = [
        HotPoint(timestamp_seconds=s + 30, timestamp_display="", score=h, signals=SignalBreakdown(rms=h), clip_start=s, clip_end=e)
        for s, e, h in windows
    ]
    transcript = VodTranscript(segments=[(1010.0, 1012.0, " il fonce dans les hélices"), (5000.0, 5002.0, " une blague posée")])
    monkeypatch.setattr(presort_module, "presort", lambda *a, **k: [
        PresortMoment(1010.0, 1060.0, 0.95, "hélices"),  # on the quiet candidate: its window takes in the reaction
        PresortMoment(5000.0, 5030.0, 0.9, "blague"),  # nowhere in the heuristics: a new candidate
    ])
    llm_analyzer.analyze_candidates("job-x", hot_points, "/nonexistent.wav", "", 6000.0, {}, chat_messages=[], vod_transcript=transcript)

    assert (1000, 1080.0) in sent[0]  # 1010-1060 with room: 1000-1080
    assert (4990.0, 5050.0) in sent[0]
    assert (100, 160) in sent[0]  # the best heuristic one still goes

