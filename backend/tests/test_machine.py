"""What this computer can do, estimated from a quick measure (first launch)."""

from app.services import machine


def test_whisper_speed_scales_from_the_measured_machines():
    # The machines it was measured on give back their own speed
    assert machine.whisper_realtime("cuda", 2.1) == 4.6
    assert machine.whisper_realtime("mlx", 6.4) == 35.0
    # A card twice as strong, twice as fast; a big one stops at the cap
    assert machine.whisper_realtime("cuda", 4.2) == 9.2
    assert machine.whisper_realtime("cuda", 30.0) == machine.MAX_REALTIME
    # Nothing to run Whisper on here
    assert machine.whisper_realtime("cpu", 1.0) is None
    assert machine.whisper_realtime("cuda", 0.0) is None


def test_the_profile_is_measured_once(monkeypatch):
    calls = []
    monkeypatch.setattr(machine, "_cached", None)
    monkeypatch.setattr(machine.transcriber, "local_backend", lambda: "cuda")
    monkeypatch.setattr(machine, "_gpu", lambda backend: calls.append(backend) or {"name": "NVIDIA GeForce RTX 4070 SUPER", "vram_gb": 12.0, "tflops": 28.0})
    monkeypatch.setattr(machine, "_voices", lambda: {"seconds": 70})

    first = machine.profile()
    assert machine.profile() is first and calls == ["cuda"]
    assert first["whisper_realtime"] == machine.MAX_REALTIME and first["voices"] == {"seconds": 70}
