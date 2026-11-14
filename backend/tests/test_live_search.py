"""Looking for moments in the whole live: by words, by asking the AI (faked)."""

import json

import pytest

from app.services import live_search as ls
from app.services import llm_text
from app.services.vod_transcript import VodTranscript


def _word(text, start, end):
    return {"word": text, "start": start, "end": end}


def _transcript(with_words=True):
    segments = [
        (100.0, 103.0, " Bon là franchement c'est calme."),
        (110.0, 112.0, " On attend la brigade"),
        (112.0, 114.5, " du tigre, elle arrive."),
        (300.0, 304.0, " Putain mais il pète les plombs !"),
        (500.0, 520.0, " alors on va faire un tour et puis c'est très calme ce soir on dirait bien que personne ne vient"),
        (900.0, 902.0, " Les calmes plats, j'adore."),
    ]
    words = []
    if with_words:
        words = [
            _word("Bon", 100.2, 100.4), _word("là", 100.45, 100.6), _word("franchement", 100.7, 101.3), _word("c'est", 101.9, 102.1), _word("calme.", 102.15, 102.7),
            _word("On", 110.1, 110.3), _word("attend", 110.35, 110.8), _word("la", 110.85, 111.0), _word("brigade", 111.05, 111.6),
            _word("du", 112.1, 112.25), _word("tigre,", 112.3, 112.9), _word("elle", 113.0, 113.2), _word("arrive.", 113.25, 113.9),
            _word("Putain", 300.2, 300.7), _word("mais", 300.8, 301.0), _word("il", 301.05, 301.15), _word("pète", 301.2, 301.6), _word("les", 301.65, 301.8), _word("plombs", 301.85, 302.5),
        ]
        # A long stretch of talk without a pause: a word every second from 500 s
        for i, text in enumerate("alors on va faire un tour et puis c'est très calme ce soir on dirait bien que personne ne vient".split()):
            words.append(_word(text, 500.0 + i * 1.0, 500.0 + i * 1.0 + 0.6))
        words += [_word("Les", 900.1, 900.3), _word("calmes", 900.35, 900.8), _word("plats,", 900.85, 901.3), _word("j'adore.", 901.4, 901.9)]
    return VodTranscript(segments=segments, words=words)


def test_words_are_compared_without_accents_plurals_or_final_e():
    assert ls.tokens("C'est TRÈS calme, ça pète !") == ["c", "est", "tres", "calme", "ca", "pete"]
    assert ls.stem("calmes") == ls.stem("calme") == "calm"
    assert ls.stem("tigre") == "tigr" and ls.stem("pète") == "pète"
    # Hollow words are dropped, unless the search is only made of them
    assert ls.query_terms("c'est calme") == ["calm"]
    assert ls.query_terms("Pète les plombs") == ["pete", "plomb"]
    assert ls.query_terms("c'est") == ["c", "est"]
    # Short terms are whole words: "or" is not in "alors"
    assert not ls._has("or", [ls.stem(w) for w in ls.tokens("alors on va")])
    assert ls._has("calm", [ls.stem(w) for w in ls.tokens("calmement")])


def test_finds_what_is_said_as_tight_sentences():
    transcript = _transcript()
    hits = ls.search_voice(transcript, ls.query_terms("calme"))
    assert [round(h.start, 1) for h in hits] == [100.2, 505.0, 900.1]
    # The sentence, from its timed words: not the whole 20 s segment
    assert hits[0].text == "Bon là franchement c'est calme." and round(hits[0].end, 1) == 102.7
    assert 6 <= hits[1].end - hits[1].start <= 13
    assert hits[2].text == "Les calmes plats, j'adore."
    # Words said across two segments
    brigade = ls.search_voice(transcript, ls.query_terms("brigade du tigre"))
    assert len(brigade) == 1 and (round(brigade[0].start, 1), round(brigade[0].end, 1)) == (110.1, 113.9)
    assert ls.search_voice(transcript, ls.query_terms("pète les plombs"))[0].text == "Putain mais il pète les plombs"
    assert ls.search_voice(transcript, ls.query_terms("licorne")) == []
    assert ls.search_voice(transcript, []) == []


def test_without_timed_words_the_segments_are_the_moments():
    hits = ls.search_voice(_transcript(with_words=False), ls.query_terms("brigade du tigre"))
    assert len(hits) == 1 and (hits[0].start, hits[0].end) == (110.0, 114.5)
    assert hits[0].text == "On attend la brigade du tigre, elle arrive."


def test_finds_what_the_chat_writes():
    chat = [
        {"timestamp": 108.0, "author": "lea", "text": "c'est trop calme"},
        {"timestamp": 115.0, "author": "bob", "text": "CALME MDR"},
        {"timestamp": 116.0, "author": "Nightbot", "text": "restez calmes"},
        {"timestamp": 700.0, "author": "zoe", "text": "calme calme"},
        {"timestamp": 705.0, "author": "zoe", "text": "rien à voir"},
    ]
    hits = ls.search_chat(chat, ["calm"], lag=5.0, duration=1000.0)
    # Two viewers 7 s apart are one moment, moved back onto the stream; the bot doesn't count
    assert [(h.start, h.end, len(h.chat)) for h in hits] == [(95.0, 113.0, 2), (687.0, 698.0, 1)]
    assert hits[0].chat[0] == "lea: c'est trop calme" and hits[0].sources == ["chat"]


def test_what_is_said_and_written_together_is_one_moment():
    transcript = _transcript()
    voice = ls.search_voice(transcript, ["calm"])
    chat = ls.search_chat([{"timestamp": 108.0, "author": "lea", "text": "trop calme"}, {"timestamp": 700.0, "author": "zoe", "text": "calme"}], ["calm"], 5.0, 1000.0)
    merged = ls.merge_hits(voice, chat)
    assert [h.sources for h in merged] == [["voice", "chat"], ["voice"], ["chat"], ["voice"]]
    assert merged[0].chat == ["lea: trop calme"]
    assert [round(h.start) for h in merged] == [100, 505, 687, 900]


def test_search_by_words_gives_what_is_said_around(monkeypatch):
    monkeypatch.setattr(ls, "load_cached", lambda job_id: _transcript())
    monkeypatch.setattr(ls, "read_chat", lambda job_id: [{"timestamp": 700.0, "author": "zoe", "text": "calme"}])
    found = ls.search_words("job", "c'est calme", duration=1000.0)
    assert found["total"] == 4 and found["transcript"] is True
    first, chat_only = found["hits"][0], found["hits"][2]
    assert (first["start"], first["end"], first["sources"]) == (100.2, 102.7, ["voice"])
    assert first["after"].startswith("On attend la brigade")
    assert chat_only["sources"] == ["chat"] and chat_only["chat"] == ["zoe: calme"]
    # A live that was never transcribed: the chat alone
    monkeypatch.setattr(ls, "load_cached", lambda job_id: None)
    assert ls.search_words("job", "calme", duration=1000.0) == {**ls.search_words("job", "calme", duration=1000.0), "transcript": False, "total": 1}


def test_the_ai_reads_lines_of_ten_seconds_with_the_loud_ones_marked():
    transcript = VodTranscript(segments=[(0.0, 4.0, "un"), (5.0, 9.0, "deux"), (12.0, 15.0, "trois"), (40.0, 43.0, "quatre")])
    assert ls.ai_lines(transcript, None, 60.0) == ["[0:00:00] un deux", "[0:00:12] trois", "[0:00:40] quatre"]
    # 60 s of live, voice energy every 5 s: the loudest line is marked
    energy = [0.1] * 12
    energy[8] = 0.9
    lines = ls.ai_lines(transcript, energy, 60.0)
    assert lines[2] == "[0:00:40] (LOUD) quatre" and "(LOUD)" not in lines[0]


def test_the_ai_s_moments_are_set_on_what_it_quoted():
    transcript = _transcript()
    raw = [
        # Times read from 10 s lines: the quote says where it really is
        {"start": "0:04:50", "end": "0:05:10", "quote": "il pète les plombs", "why": "Il s'énerve", "score": 90},
        # Times wrong by half a minute: the quote brings the window back
        {"start": "0:01:15", "end": "0:01:25", "quote": "franchement c'est calme", "why": "", "score": "x"},
        # Nothing to hold on to: the window as given, on the sentences it touches
        {"start": "0:15:00", "end": "0:15:01", "quote": "", "why": "fin"},
        {"start": None, "end": "0:01:00"},
        "nonsense",
    ]
    hits = ls.parse_moments(raw, transcript, duration=1000.0)
    assert len(hits) == 3
    assert (round(hits[0].start, 1), round(hits[0].end, 1)) == (300.2, 302.5) and hits[0].score == 0.9 and hits[0].why == "Il s'énerve"
    assert hits[1].start <= 100.7 and hits[1].end >= 102.7 and hits[1].score == 0.5
    assert hits[2].start == 900.1 and hits[2].end - hits[2].start == ls.MIN_MOMENT
    assert all(h.sources == ["ai"] for h in hits)
    # The quote, to its very words when they are timed; to its segments otherwise
    assert ls.locate_quote(transcript, "la brigade du tigre arrive", (90.0, 130.0)) == (111.05, 113.9)
    assert ls.locate_quote(_transcript(with_words=False), "la brigade du tigre arrive", (90.0, 130.0)) == (110.0, 114.5)
    assert ls.locate_quote(transcript, "rien à voir avec ça", (90.0, 130.0)) is None


def test_the_ai_s_moments_keep_the_length_it_meant():
    # Segments only (this computer's engine gives no timed words)
    transcript = _transcript(with_words=False)
    # 8 s asked around a quote said 20 s later: the window goes there, still about 8 s, on a sentence's edge
    moved = ls.parse_moments([{"start": "0:01:20", "end": "0:01:28", "quote": "franchement c'est calme"}], transcript, 1000.0)[0]
    assert moved.start == 100.0 and 6.0 <= moved.end - moved.start <= 9.0
    # A whole scene of 2 minutes: its best part, from what it quoted
    long = ls.parse_moments([{"start": "0:08:00", "end": "0:10:00", "quote": "c'est très calme ce soir"}], transcript, 1000.0)[0]
    assert long.end - long.start <= ls.MAX_MOMENT + ls.SNAP_REACH and long.start <= 500.0 <= long.end
    planned = ls.parse_moments([{"start": "0:08:00", "end": "0:10:00", "quote": "c'est très calme ce soir"}], transcript, 1000.0, longest=ls.MAX_PLANNED)[0]
    assert planned.end - planned.start <= ls.MAX_PLANNED + ls.SNAP_REACH


def test_asking_the_ai_is_paid_once(monkeypatch, tmp_path):
    monkeypatch.setattr(ls, "load_cached", lambda job_id: _transcript())
    monkeypatch.setattr(ls, "read_chat", lambda job_id: [])
    monkeypatch.setattr(ls.paths, "transcript_dir", lambda job_id: str(tmp_path))
    asked = []

    def answer(prompt, **kwargs):
        asked.append(prompt)
        return llm_text.Answer(json.dumps({"moments": [{"start": "0:05:00", "end": "0:05:03", "quote": "il pète les plombs", "why": "colère", "score": 80}]}), 1000, 100, 0.012, 1.0)

    monkeypatch.setattr(ls.llm_text, "complete", answer)
    first = ls.search_ai("job", "Les moments où il pète les plombs", {"streamer": "Falkarst"}, 1000.0)
    assert first["cached"] is False and first["cost"] == 0.012 and first["hits"][0]["why"] == "colère"
    # The transcript comes before the question: the provider can reuse what it read
    assert asked[0].index("TRANSCRIPT") < asked[0].index("THE STREAMER IS LOOKING FOR") and "Falkarst" in asked[0]
    again = ls.search_ai("job", "les moments où il pète les plombs ", {}, 1000.0)
    assert again["cached"] is True and again["cost"] == 0.0 and again["hits"] == first["hits"] and len(asked) == 1

    monkeypatch.setattr(ls, "load_cached", lambda job_id: None)
    with pytest.raises(ls.NoTranscript):
        ls.search_ai("job", "autre chose", {}, 1000.0)


def test_the_ai_plans_a_video_in_sections(monkeypatch, tmp_path):
    monkeypatch.setattr(ls, "load_cached", lambda job_id: _transcript())
    monkeypatch.setattr(ls, "read_chat", lambda job_id: [])
    monkeypatch.setattr(ls.paths, "transcript_dir", lambda job_id: str(tmp_path))
    plan = {
        "title": "Maurice",
        "sections": [
            {"title": "C'est calme", "moments": [{"start": "0:15:00", "end": "0:15:02", "quote": "Les calmes plats"}, {"start": "0:01:40", "end": "0:01:43", "quote": "franchement c'est calme"}]},
            {"title": "Vide", "moments": []},
            {"title": "Les plombs", "moments": [{"start": "0:05:00", "end": "0:05:03", "quote": "il pète les plombs"}]},
        ],
    }
    monkeypatch.setattr(ls.llm_text, "complete", lambda prompt, **k: llm_text.Answer(f"```json\n{json.dumps(plan)}\n```", 1000, 200, 0.02, 2.0))
    planned = ls.plan_video("job", "d'abord le calme puis les plombs", 30.0, {}, 1000.0)
    assert planned["title"] == "Maurice" and [s["title"] for s in planned["sections"]] == ["C'est calme", "Les plombs"]
    # In the order the AI gave, not the stream's
    assert [round(h["start"]) for h in planned["sections"][0]["hits"]] == [900, 100]
    assert ls.plan_video("job", "D'abord le calme, puis les plombs", 30.0, {}, 1000.0)["cached"] is True


def test_a_clip_s_words_become_sentences_and_the_ai_keeps_parts(monkeypatch):
    words = [
        {"word": "Regarde", "start": 1.0, "end": 1.4, "speaker": "Falkarst"},
        {"word": "ça.", "start": 1.5, "end": 1.8, "speaker": "Falkarst"},
        {"word": "Non", "start": 3.0, "end": 3.2, "speaker": "Falkarst"},
        {"word": "mais", "start": 3.25, "end": 3.4, "speaker": "Falkarst"},
        {"word": "attends", "start": 3.45, "end": 3.9, "speaker": "SPEAKER_01"},
    ]
    assert ls.clip_lines(words) == ["[1.0-1.8] Falkarst: Regarde ça.", "[3.0-3.4] Falkarst: Non mais", "[3.5-3.9] SPEAKER_01: attends"]

    prompts = []

    def answer(prompt, **kwargs):
        prompts.append(prompt)
        return llm_text.Answer(json.dumps({"parts": [{"start": 20, "end": 31.5}, {"start": 1.0, "end": 3.9}, {"start": 50, "end": 50.2}, {"end": 3}], "note": "Le contexte puis la chute"}), 300, 50, 0.001, 1.0)

    monkeypatch.setattr(ls.llm_text, "complete", answer)
    cut = ls.suggest_cut(words, 60.0, summary="Un tigre", current=[[10.0, 40.0]], wish="plus court")
    # In the clip's order, a little air around each part, the nonsense dropped
    assert cut["parts"] == [[0.85, 4.15], [19.85, 31.75]] and cut["note"] == "Le contexte puis la chute" and cut["cost"] == 0.001
    assert "10.0-40.0" in prompts[0] and "plus court" in prompts[0] and "Un tigre" in prompts[0]
    with pytest.raises(ls.NoTranscript):
        ls.suggest_cut([], 60.0)


def test_what_a_call_costs_and_the_answer_s_json():
    assert llm_text.estimate_cost(330_000, answer_tokens=5000) == pytest.approx(0.065, abs=0.001)
    assert llm_text.parse_json('Voici :\n```json\n{"moments": []}\n```') == {"moments": []}
    with pytest.raises(ValueError):
        llm_text.parse_json("[1, 2]")


def test_the_development_command_answers_instead_of_openrouter(monkeypatch):
    monkeypatch.setenv("CUTTIE_LLM_CMD", "python3 -c \"import sys; print('{\\\"echo\\\": ' + str(len(sys.stdin.read())) + '}')\"")
    answer = llm_text.complete("bonjour")
    assert llm_text.parse_json(answer.text) == {"echo": 7} and answer.cost == 0.0
    monkeypatch.setenv("CUTTIE_LLM_CMD", "python3 -c \"import sys; sys.exit(3)\"")
    with pytest.raises(RuntimeError):
        llm_text.complete("bonjour")
