"""A passage of the live cut on its words: where its text is among the timed words, and where the voice starts and stops."""

import numpy as np

from app.services import tight_cut
from app.services.vod_transcript import VodTranscript


def _words(*timed):
    return [{"word": w, "start": s, "end": e} for w, s, e in timed]


def _sound(seconds, *spoken, level=-20.0, floor=-70.0):
    """A sound level per 10 ms: `floor` everywhere, `level` during each (start, end) of `spoken`."""
    env = np.full(int(seconds * tight_cut.ENV_RATE), floor, dtype=np.float32)
    for start, end in spoken:
        env[int(start * tight_cut.ENV_RATE) : int(end * tight_cut.ENV_RATE)] = level
    return env


def test_a_passage_is_the_lines_that_sit_in_it():
    # The local engine gives lines only, and their times hold silence: a 2 s sentence in a 6 s line
    live = VodTranscript(segments=[(100.0, 102.0, " Tout va bien."), (102.0, 108.0, " Rien il a redit que c'était calme"), (108.0, 110.0, " ce bâtard")])
    assert tight_cut.passage_text(live, 102.0, 108.0) == "Rien il a redit que c'était calme"
    # Several lines; one that only overlaps the passage's edge is not part of it
    assert tight_cut.passage_text(live, 101.5, 110.0) == "Rien il a redit que c'était calme ce bâtard"
    # No line with its middle inside: the one it overlaps most
    assert tight_cut.passage_text(live, 103.0, 104.0) == "Rien il a redit que c'était calme"
    assert tight_cut.passage_text(live, 200.0, 204.0) == ""
    # With timed words, the words themselves
    timed = VodTranscript(segments=live.segments, words=_words(("Rien", 104.2, 104.5), ("il", 104.6, 104.7), ("a", 104.7, 104.8), ("redit", 104.8, 105.1), ("ok", 109.0, 109.2)))
    assert tight_cut.passage_text(timed, 104.0, 105.2) == "Rien il a redit"


def test_finds_the_passage_among_the_timed_words():
    words = _words(
        ("Tout", 0.4, 0.6), ("va", 0.6, 0.8), ("bien.", 0.8, 1.2),
        ("Rien,", 5.0, 5.4), ("il", 5.5, 5.6), ("a", 5.6, 5.7), ("redit", 5.7, 6.0), ("que", 6.0, 6.1), ("c'était", 6.1, 6.3), ("calme", 6.3, 6.7), ("ce", 6.7, 6.8), ("bâtard.", 6.8, 7.2),
        ("C'est", 9.0, 9.2), ("ce", 9.2, 9.3), ("qu'il", 9.3, 9.5), ("a", 9.5, 9.6), ("dit.", 9.6, 9.9),
    )
    # The line's times (2-8 s) are rough; its words are found whatever their accents, case and punctuation
    assert tight_cut.locate(words, "rien il a redit que c'etait calme ce batard", 2.0, 8.0) == (3, 11)
    # Another sentence that shares words with it ("ce", "a") is not part of it
    assert tight_cut.locate(words, "Rien il a redit que c'était calme", 2.0, 10.0) == (3, 9)
    # Too little of it is said there: left alone
    assert tight_cut.locate(words, "une explosion au loin puis des sirènes", 2.0, 8.0) is None
    assert tight_cut.locate(words, "Rien il a redit que c'était calme", 40.0, 46.0) is None
    assert tight_cut.locate([], "calme", 0.0, 5.0) is None


def test_a_word_heard_otherwise_at_the_edge_stays_in_the_passage():
    # The live's transcript heard "Cytale", the clip's own "c'est calme": the words that run on are those
    words = _words(("Bon,", 1.0, 1.3), ("soit", 1.4, 1.6), ("c'est", 1.6, 1.8), ("bon", 1.8, 2.0), ("signe", 2.0, 2.3), ("que", 2.3, 2.4), ("c'est", 2.45, 2.6), ("calme.", 2.6, 3.0), ("Non,", 3.6, 3.9))
    assert tight_cut.locate(words, "Bon, soit c'est bon signe que Cytale.", 0.5, 5.0) == (0, 7)
    # ...but never across the end of a sentence, nor a pause
    words = _words(("Ok.", 0.5, 0.8), ("C'est", 0.9, 1.1), ("un", 1.1, 1.2), ("peu", 1.2, 1.4), ("moins", 1.4, 1.7), ("calme.", 1.7, 2.1), ("Tu", 2.15, 2.3))
    assert tight_cut.locate(words, "Bah c'est un peu moins calme ouais", 0.0, 4.0) == (1, 5)


def test_cuts_with_a_little_air_and_never_into_a_neighbour():
    words = _words(("avant.", 0.5, 1.0), ("C'est", 2.0, 2.2), ("calme.", 2.2, 2.7), ("Après", 4.0, 4.3))
    start, end = tight_cut.bounds(words, 1, 2)
    assert (round(start, 2), round(end, 2)) == (1.92, 2.86)
    # A neighbour that runs into the passage: the cut goes between the two words
    tied = _words(("avant", 1.8, 1.95), ("C'est", 2.0, 2.2), ("calme", 2.2, 2.7), ("après", 2.8, 3.1))
    start, end = tight_cut.bounds(tied, 1, 2)
    assert (round(start, 3), round(end, 3)) == (1.975, 2.75)
    # Never past the end of the clip
    assert tight_cut.bounds(words, 3, 3, length=4.35)[1] == 4.35


def test_the_cut_follows_the_voice_not_the_words_times():
    # The voice is heard from 3.0 to 4.2 s; the words' times start too early and the last one runs on into the silence
    words = _words(("avant.", 0.5, 1.0), ("C'est", 2.7, 3.3), ("calme.", 3.3, 5.4), ("Après", 6.5, 6.8))
    sound = _sound(8.0, (0.5, 1.0), (3.0, 4.2), (6.5, 6.8))
    start, end = tight_cut.bounds(words, 1, 2, sound)
    assert abs(start - (3.0 - tight_cut.AIR_IN)) < 0.03
    assert abs(end - (4.2 + tight_cut.AIR_OUT)) < 0.03
    # A voice over a steady noise (a game): quiet is what is close to the noise, not silence
    noisy = _sound(8.0, (0.5, 1.0), (3.0, 4.2), (6.5, 6.8), level=-20.0, floor=-38.0)
    start, end = tight_cut.bounds(words, 1, 2, noisy)
    assert abs(start - (3.0 - tight_cut.AIR_IN)) < 0.03 and abs(end - (4.2 + tight_cut.AIR_OUT)) < 0.03
    # A sound that never drops (someone else speaks over): the words' times, as without the sound
    loud = _sound(8.0, (0.0, 8.0))
    assert tight_cut.bounds(words, 1, 2, loud) == tight_cut.bounds(words, 1, 2)


def test_a_passage_is_cut_on_its_words():
    words = _words(("Tout", 0.4, 0.6), ("va", 0.6, 0.8), ("bien.", 0.8, 1.2), ("Rien,", 5.0, 5.4), ("il", 5.5, 5.6), ("a", 5.6, 5.7), ("redit.", 5.7, 6.1), ("Voilà", 8.0, 8.4))
    sound = _sound(10.0, (0.4, 1.2), (5.1, 6.2), (8.0, 8.4))
    # The line said 2 to 8 s; the sentence is said from 5.1 to 6.2 s
    start, end = tight_cut.fit(words, "Rien il a redit", 2.0, 8.0, sound)
    assert abs(start - 5.0) < 0.03 and abs(end - 6.3) < 0.03
    # Words not found there: nothing to cut on
    assert tight_cut.fit(words, "une explosion", 2.0, 8.0, sound) is None


def test_the_sound_level_of_samples():
    rate = tight_cut.ENV_SAMPLES
    samples = np.zeros(rate * 2, dtype=np.float32)
    samples[rate:] = 0.5 * np.sin(np.arange(rate) * 2 * np.pi * 220 / rate)
    env = tight_cut.envelope_of(samples)
    assert len(env) == 2 * tight_cut.ENV_RATE
    assert env[50] < -80 and -12 < env[150] < -6
    assert tight_cut.envelope_of(samples[:100]) is None


def test_a_dip_inside_the_last_word_is_not_its_end():
    # "submergé": the voice dips for a tenth of a second in the middle of the word, then goes on
    words = _words(("un", 1.0, 1.2), ("peu", 1.2, 1.4), ("submergé.", 1.4, 2.0))
    sound = _sound(4.0, (1.0, 1.55), (1.66, 2.0))
    assert abs(tight_cut.bounds(words, 0, 2, sound)[1] - 2.1) < 0.03
    # A hole in a shout, the end of the word, then someone else: the voice stops where the word's time says, not after the other one
    sound = _sound(4.0, (1.0, 1.5), (1.7, 2.0), (2.3, 2.38))
    assert abs(tight_cut.bounds(words, 0, 2, sound)[1] - 2.1) < 0.03


def test_a_neighbours_wrong_time_does_not_move_the_cut():
    # The next word's time starts right at the passage's end, but it is only said a second later
    words = _words(("ce", 1.0, 1.2), ("bâtard.", 1.2, 1.6), ("C'est", 1.6, 2.9))
    sound = _sound(4.0, (1.0, 1.68), (2.6, 2.9))
    assert abs(tight_cut.bounds(words, 0, 1, sound)[1] - 1.78) < 0.03
    # Same before it: the word before is given a time that runs up to the passage, but was said long before
    words = _words(("Vérifie.", 0.2, 1.95), ("T'as", 2.0, 2.4), ("dit", 2.4, 2.6))
    sound = _sound(4.0, (0.2, 0.7), (2.3, 2.6))
    assert abs(tight_cut.bounds(words, 1, 2, sound)[0] - 2.2) < 0.03
    # Words that really run into each other: the cut goes between them, in the dip
    words = _words(("avant", 1.0, 1.5), ("c'est", 1.52, 1.8), ("calme", 1.8, 2.2), ("après", 2.22, 2.6))
    sound = _sound(4.0, (1.0, 2.6))
    start, end = tight_cut.bounds(words, 1, 2, sound)
    assert 1.45 <= start <= 1.57 and 2.15 <= end <= 2.27


def test_a_punctuation_mark_with_a_time_of_its_own_belongs_to_the_word_before():
    words = _words(("sale", 1.0, 1.2), ("bâtard", 1.2, 1.6), ("!", 1.6, 2.1), ("Bon,", 2.5, 2.8))
    sound = _sound(4.0, (1.0, 2.0), (2.5, 2.8))
    start, end = tight_cut.fit(words, "sale bâtard", 0.5, 3.0, sound)
    assert abs(end - 2.1) < 0.03


def test_a_passage_that_stops_mid_sentence_goes_on_to_its_end():
    # The transcript's line ends at "de toute façon"; the speaker goes on without a breath until "les frères"
    words = _words(
        ("Moi", 2.0, 2.26), ("je", 2.26, 2.38), ("dis", 2.38, 2.46), ("que", 2.46, 2.56), ("c'est", 2.56, 2.7), ("calme", 2.7, 2.96),
        ("mais", 2.96, 3.04), ("de", 3.04, 3.14), ("toute", 3.14, 3.22), ("façon", 3.22, 3.32),
        ("les", 3.32, 3.8), ("collègues", 3.8, 4.12), ("désolé", 4.2, 4.6), ("les", 4.6, 4.7), ("frères", 4.7, 5.0),
        ("Jusqu'à", 5.7, 6.2), ("quelle", 6.2, 6.5),
    )
    assert tight_cut.finish_sentence(words, 0, 9) == 14
    start, end = tight_cut.fit(words, "moi je dis que c'est calme mais de toute façon", 1.5, 3.9)
    assert (round(start, 2), round(end, 2)) == (1.92, 5.16)
    # A comma, then the end of the sentence two words later
    short = _words(("C'est", 1.0, 1.3), ("moins", 1.3, 1.5), ("calme,", 1.5, 1.9), ("c'est", 1.95, 2.1), ("vrai.", 2.1, 2.4), ("Tu", 2.45, 2.6), ("vois", 2.6, 2.9))
    assert tight_cut.finish_sentence(short, 0, 2) == 4
    # It already ends its sentence, or the speaker breathes there: nothing more
    assert tight_cut.finish_sentence(short, 0, 4) == 4
    assert tight_cut.finish_sentence(words, 0, 14) == 14
    # Someone who goes on for long is cut where the passage ends
    long = _words(*[(f"mot{i}", 1.0 + 0.3 * i, 1.3 + 0.3 * i) for i in range(30)])
    assert tight_cut.finish_sentence(long, 0, 3) == 3
    # The words' times touch, but the sound shows the breath (a word's time runs on over the silence after it)
    touching = _words(("c'est", 1.0, 1.3), ("calme", 1.3, 2.6), ("Ensuite", 2.6, 3.0), ("on", 3.0, 3.2))
    assert tight_cut.finish_sentence(touching, 0, 1) == 3
    assert tight_cut.finish_sentence(touching, 0, 1, _sound(4.0, (1.0, 1.8), (2.6, 3.2))) == 1


def test_a_sentence_heard_differently_in_the_middle_does_not_lose_the_passage():
    # The live's transcript heard "Ouais dix-quatre" where the clip's own heard "Allez, discade": the passage is still found whole
    words = _words(
        ("quand", 0.5, 0.7), ("même.", 0.7, 0.9), ("Et", 1.3, 1.5), ("on", 1.5, 1.65), ("va", 1.65, 1.8), ("être", 1.8, 1.95), ("submergés.", 1.95, 2.6),
        ("Allez,", 4.6, 4.9), ("discade,", 4.9, 5.3),
        ("je", 7.0, 7.1), ("vous", 7.1, 7.25), ("ouvre", 7.25, 7.5), ("ça", 7.5, 7.6), ("tout", 7.6, 7.75), ("de", 7.75, 7.85), ("suite.", 7.85, 8.2),
        ("Bah", 9.5, 9.7), ("moi", 9.7, 9.9),
    )
    assert tight_cut.locate(words, "On va être submergés. Ouais dix-quatre. Je vous ouvre ça tout de suite.", 1.0, 9.0) == (3, 15)
    # ...but a word or two found seconds before the rest are not its beginning
    words = _words(("c'est", 0.5, 0.7), ("fini.", 0.7, 1.0), ("Là", 4.0, 4.2), ("c'est", 4.2, 4.4), ("la", 4.4, 4.5), ("merde", 4.5, 4.9), ("Tito.", 4.9, 5.3))
    assert tight_cut.locate(words, "Ah c'est... là c'est la merde Tito", 0.0, 6.0) == (2, 6)
