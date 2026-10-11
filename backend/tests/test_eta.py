"""When an analysis should be done: the first guess, then the real pace."""

from app.services import eta

LIVE = 7 * 3600 + 39 * 60  # the live analyzed on the Mac and on the test PC


def test_the_first_guess_follows_the_live_the_engine_and_the_computer():
    # The test PC: Whisper at 4.6x on its GTX 1650, the analysis took 2 h
    pc = eta.AnalysisEta("job", LIVE, "local", 4.6, now=0)
    assert 100 * 60 < pc.end(now=0) < 130 * 60
    # The Mac (mlx, 35x): 19 min
    mac = eta.AnalysisEta("job", LIVE, "local", 35.0, now=0)
    assert 15 * 60 < mac.end(now=0) < 25 * 60
    # With Groq the transcript is no longer the long part
    groq = eta.AnalysisEta("job", LIVE, "groq", None, now=0)
    assert groq.end(now=0) < 12 * 60


def test_the_real_pace_replaces_the_guess():
    estimate = eta.AnalysisEta("job", 6000, "local", 20.0, now=0)
    first = estimate.end(now=0)
    estimate.observe("ANALYZING_AUDIO", None, now=30)  # downloaded
    # One chunk of 10 in 300 s: this computer is slower than measured
    estimate.transcribing(1, 10, now=330)
    assert estimate.end(now=330) > 30 + 3000 > first

    # The transcript is in, the AI rates the passages: 10 of 50 in 20 s
    estimate.transcribing(10, 10, now=3100)
    estimate.observe("ANALYZING_CLIPS", "Analyse IA : 1 sur 50 candidats...", now=3200)
    estimate.observe(None, "Analyse IA : 11 sur 50 candidats...", now=3220)
    rated = 3220 + 2.0 * 39
    assert estimate.end(now=3220) == rated + eta.CLIP_SECONDS + estimate.words

    # Clips: 5 of 20 in 50 s
    estimate.observe("CLIPPING", "Extraction clips (0/20)...", now=3300)
    estimate.observe(None, "Extraction clips (5/20)...", now=3350)
    assert estimate.end(now=3350) == 3350 + 150 + eta.CLIP_SECONDS * 0.2 + estimate.words


def test_an_estimate_is_sent_when_it_moves(monkeypatch):
    sent = []
    monkeypatch.setattr("app.services.timeline.publish", lambda job_id, **fields: sent.append(fields["eta"]))
    estimate = eta.AnalysisEta("job", 6000, "groq", None, now=1000)
    estimate.publish(now=1000)
    estimate.publish(now=1005)  # nothing new
    assert len(sent) == 1 and sent[0]["start"] == 1000
    estimate.observe("ANALYZING_AUDIO", None, now=1006)
    estimate.transcribing(1, 10, now=1500)  # far slower than Groq should be
    estimate.publish(now=1500)
    assert len(sent) == 2 and sent[1]["end"] > sent[0]["end"]


def test_only_tracked_analyses_follow_job_updates(monkeypatch):
    sent = []
    monkeypatch.setattr("app.services.timeline.publish", lambda job_id, **fields: sent.append((job_id, fields)))
    eta.observe("untracked", status="ANALYZING_AUDIO")
    assert sent == []
    eta.track("tracked", 3600, "groq", None)
    assert sent[-1][0] == "tracked"
    eta.observe("tracked", status="DONE")
    assert "tracked" not in eta._tracked
