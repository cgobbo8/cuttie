"""Compilations worth making from a live, found by the AI on its own.

Once a live is analysed, nobody has asked for anything yet. The AI goes through
it with the tools of the search (live_tools.py) plus one of its own, `recurring`
(what is said again and again), and proposes a few videos: something said ten
times, the same thing happening over and over, a story the live tells. Each idea
comes with the request a streamer would have typed to get that video: the app
shows the idea, and builds the video from that request when the streamer opens it
(live_search.plan_video), as if they had asked for it themselves.

Finding the ideas is cheap (a search with tools); building a video is what costs,
and only happens for the ideas the streamer opens.
"""

import hashlib
import logging
import math
import os

from app.services import live_search, llm_text, paths
from app.services.presort import hms, parse_hms
from app.services.vod_transcript import VodTranscript, load_cached

logger = logging.getLogger(__name__)

# Ideas proposed for one live at most, and what one must have to be proposed
MAX_IDEAS = 5
MIN_SCORE = 50
MIN_MOMENTS = 3
MIN_SECONDS, MAX_SECONDS, USUAL_SECONDS = 20.0, 120.0, 45.0
# The kinds of video (the ones the musics are sorted by)
KINDS = ("funny", "skill", "suspense", "chill", "hype")
# Changes when the instructions do: ideas kept on disk under the old ones are looked for again
IDEAS_VERSION = "2"

# ── What is said again and again ─────────────────────────────────────────────

# A phrase must be said on this many lines to count as coming back; a single word on more
MIN_PHRASE_LINES, MIN_WORD_LINES = 4, 6
# ...and this many times more often than in the streamer's other lives, when there are some to compare with
MIN_LIFT = 2.5
# Other lives of the data folder read to know what is said in every live
MAX_OTHER_LIVES = 5
# Words that say nothing on their own (a word alone must not be one of these; a phrase may hold some)
_COMMON = live_search._STOP | set(
    """
    ah ai aie ais ait alors apres as assez au aussi autre autres avais avait avant avec avez avoir avons bah beaucoup ben bien bon bonne
    car cela celle celui cest cet cette ceux chose choses comme comment contre dans deja depuis dire dis dit dois doit donc dont du eh
    encore enfin entre est etait ete etes etre eu euh eux fais faire fait faut fois font franchement gars genre hein hop ici ils jai
    jamais juste la le les leur leurs lui ma mais mal meme mes mec merci mettre moi moins mon mais ne non nos notre nous oh ok okay ont
    ou ouais oui par parce pas passe petit peu peut peux plus plutot pour pourquoi pouvoir prend prendre pris puis quand quel quelle
    quelque quoi rien sa sais sait sans se sera ses si son sont sous suis sur ta tas te tes toi ton toujours tous tout toute toutes
    tres trop truc trucs va vais vas veux vient viens voila voir vois vont vos votre vous vraiment vu wesh
    about all also am are as at be because been but by can did do does for from get go going got had has have he her here him his how
    if into just know like me my no not now oh on one or our out really right she so some than that their them then there they this
    was we well were what when where which who why will with would yeah yes you your
    """.split()
)


def _grams(text: str) -> dict[tuple[str, ...], str]:
    """The words and phrases of one line (1 to 4 words, never starting or ending on a hollow word), each once:
    {its stems: its words as said}."""
    words = live_search.tokens(text)
    found: dict[tuple[str, ...], str] = {}
    for size in (1, 2, 3, 4):
        for i in range(len(words) - size + 1):
            gram = words[i : i + size]
            if size == 1:
                if len(gram[0]) < 4 or gram[0] in _COMMON or gram[0].isdigit():
                    continue
            elif gram[0] in live_search._STOP or gram[-1] in live_search._STOP or all(w in _COMMON for w in gram):
                continue
            found.setdefault(tuple(live_search.stem(w) for w in gram), " ".join(gram))
    return found


def _other_lives(job_id: str) -> list[VodTranscript]:
    """The transcripts of the other lives of this data folder, the latest first: what is said in every live."""
    try:
        others = [d for d in os.listdir(paths.TRANSCRIPTS_DIR) if d != job_id and os.path.isdir(os.path.join(paths.TRANSCRIPTS_DIR, d))]
    except OSError:
        return []
    others.sort(key=lambda d: os.path.getmtime(os.path.join(paths.TRANSCRIPTS_DIR, d)), reverse=True)
    found: list[VodTranscript] = []
    for other in others:
        transcript = load_cached(other)
        if transcript and len(transcript.segments) > 200:
            found.append(transcript)
        if len(found) >= MAX_OTHER_LIVES:
            break
    return found


def recurring(transcript: VodTranscript, others: list[VodTranscript] | None = None, limit: int = 30) -> list[dict]:
    """The words and phrases that come back in a live, the most telling first: said on many lines, and
    (when `others`, the streamer's other lives, are given) much more often than there. A phrase held in a
    longer one that is said about as often is left out. Each: {"said", "times", "first", "last", "at"}."""
    lines = [(start, text) for start, _end, text in transcript.segments if text.strip()]
    said: dict[tuple[str, ...], list[float]] = {}
    words: dict[tuple[str, ...], str] = {}
    for start, text in lines:
        for key, shown in _grams(text).items():
            said.setdefault(key, []).append(start)
            words.setdefault(key, shown)
    kept = {key: times for key, times in said.items() if len(times) >= (MIN_WORD_LINES if len(key) == 1 else MIN_PHRASE_LINES)}

    # How often the same is said in the other lives: what a streamer says every evening is not this live's
    lift: dict[tuple[str, ...], float] = {}
    usual: dict[tuple[str, ...], int] = {}
    their_lines = 0
    for other in others or []:
        for _start, _end, text in other.segments:
            if not text.strip():
                continue
            their_lines += 1
            for key in _grams(text):
                if key in kept:
                    usual[key] = usual.get(key, 0) + 1
    if their_lines:
        for key, times in kept.items():
            lift[key] = (len(times) / len(lines)) / ((usual.get(key, 0) + 0.5) / (their_lines + 1))
        kept = {key: times for key, times in kept.items() if lift[key] >= MIN_LIFT}

    def weight(key: tuple[str, ...]) -> float:
        # A phrase tells more than a word; said more than usual tells more than said often
        return len(kept[key]) * (1.0 + 0.5 * (len(key) - 1)) * (math.log2(1.0 + min(lift[key], 60.0)) if lift else 1.0)

    def inside(short: tuple[str, ...], long: tuple[str, ...]) -> bool:
        return len(short) < len(long) and any(long[i : i + len(short)] == short for i in range(len(long) - len(short) + 1))

    picked: list[tuple[str, ...]] = []
    for key in sorted(kept, key=lambda k: (-len(k), -len(kept[k]))):
        # Longest first: "brigade tigre" stands for "brigade" and "tigre" when nearly every one of them is in it
        if any(inside(key, longer) and len(kept[longer]) >= 0.7 * len(kept[key]) for longer in picked):
            continue
        picked.append(key)
    picked.sort(key=lambda k: -weight(k))
    return [
        {
            "said": words[key],
            "times": len(kept[key]),
            "first": hms(kept[key][0]),
            "last": hms(kept[key][-1]),
            # A few of the times it is said, spread over them all
            "at": [hms(kept[key][i]) for i in sorted({round(j * (len(kept[key]) - 1) / 4) for j in range(5)})],
            **({"more_than_usual": f"x{lift[key]:.0f}"} if lift else {}),
        }
        for key in picked[:limit]
    ]


# ── The ideas ────────────────────────────────────────────────────────────────


def idea_key(title: str, brief: str) -> str:
    """What names an idea from one search of a live to the next: the same idea is not proposed twice."""
    return hashlib.sha1(" ".join(live_search.tokens(f"{title} {brief}")[:40]).encode("utf-8")).hexdigest()[:12]


def clean_ideas(raw, duration: float, most: int = MAX_IDEAS) -> list[dict]:
    """The ideas a model gave, as the app keeps them: checked, bounded, the best first. An idea with no
    request to build it from, with too few moments or with a low score is dropped."""
    ideas: list[dict] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        title = " ".join(str(item.get("title") or "").split())[:80]
        brief = " ".join(str(item.get("brief") or "").split())[:1200]
        if not title or len(brief) < 20:
            continue
        try:
            score = round(max(0.0, min(100.0, float(item.get("score")))))
        except (TypeError, ValueError):
            score = 0
        moments: list[float] = []
        for stamp in item.get("moments") if isinstance(item.get("moments"), list) else []:
            at = parse_hms(stamp) if not isinstance(stamp, (int, float)) else float(stamp)
            if at is not None and 0 <= at <= (duration or at) and all(abs(at - other) > 2.0 for other in moments):
                moments.append(round(at, 1))
        if score < MIN_SCORE or len(moments) < MIN_MOMENTS:
            continue
        key = idea_key(title, brief)
        if key in seen:
            continue
        seen.add(key)
        try:
            seconds = max(MIN_SECONDS, min(MAX_SECONDS, float(item.get("seconds"))))
        except (TypeError, ValueError):
            seconds = USUAL_SECONDS
        tags: list[str] = []
        for tag in item.get("tags") if isinstance(item.get("tags"), list) else []:
            tag = " ".join(str(tag).split()).strip("#").lower()[:24]
            if tag and tag not in tags:
                tags.append(tag)
        ideas.append({
            "key": key,
            "title": title,
            "brief": brief,
            "seconds": round(seconds),
            "pitch": " ".join(str(item.get("pitch") or "").split())[:280],
            "tags": tags[:4],
            "kind": item.get("kind") if item.get("kind") in KINDS else None,
            "score": score,
            "moments": sorted(moments)[:40],
        })
    ideas.sort(key=lambda idea: -idea["score"])
    return ideas[:most]


def _reading_prompt(lines: list[str], chat: list[str], best: list[dict], again: list[dict], meta: dict, most: int) -> str:
    """The whole live read at once (development command: it cannot call tools)."""
    from app.services import live_agent

    return f"""{live_search._header(meta)}

{live_search._body(lines, chat)}

THE MOMENTS THE ANALYSIS RATED THE BEST
{chr(10).join(f"[{m.get('at')}] {m.get('kind') or ''} · {m.get('name') or ''} · {m.get('what') or ''}" for m in best) or "(none)"}

WHAT IS SAID AGAIN AND AGAIN
{chr(10).join(f"« {r['said']} » x{r['times']} (from {r['first']} to {r['last']})" for r in again) or "(nothing stands out)"}

{live_agent.IDEAS_WHAT}

Propose {most} videos at most, the best first, none when the live has nothing that repeats or builds. Answer with JSON only:
{{"ideas": [{{"title": "...", "brief": "the request the streamer would type to get this video", "seconds": 20-90, "pitch": "one sentence: what you noticed",
"tags": ["...", "..."], "kind": "funny|skill|suspense|chill|hype", "score": 0-100, "moments": ["H:MM:SS", "..."]}}], "note": "..."}}
Everything the streamer reads (title, brief, pitch, tags, note) is in the stream's language."""


def suggest_videos(
    job_id: str, meta: dict, duration: float, energy: list[float] | None = None, lag: float = 5.0,
    url: str | None = None, moments: list[dict] | None = None, most: int = MAX_IDEAS,
) -> dict:
    """The compilations worth making from this live: {"ideas": [...], "note", "cost", "cached"}.
    Each idea: its title, the request to build it from (`brief`), its length, why (`pitch`), tags, the kind of
    video, how well it should do (`score`, 0-100) and the moments seen for it (live seconds).
    Kept on disk: the same live is only looked through once."""
    from app.services import live_agent
    from app.services.live_tools import LiveTools

    live_search.relisten(job_id, url)
    transcript = load_cached(job_id)
    if not transcript:
        raise live_search.NoTranscript(job_id)
    dev = bool(llm_text.dev_command())
    path = live_search._cache_path(
        job_id, "ideas", live_search._signature(transcript), "dev" if dev else live_agent.IDEAS_MODEL, IDEAS_VERSION, str(most), *live_search.answered_by(),
    )
    kept = live_search._cached(path)
    if kept:
        return {**kept, "cached": True, "cost": 0.0}
    if dev:
        _transcript, lines, chat = live_search._reading(job_id, duration, energy, lag)
        tools = LiveTools(job_id, duration, lag, moments)
        answer = llm_text.complete(_reading_prompt(lines, chat, tools.tool_best_moments()["moments"], tools.tool_recurring().get("phrases", []), meta, most))
        data = llm_text.parse_json(answer.text)
        result = {"ideas": clean_ideas(data.get("ideas"), duration, most), "note": str(data.get("note") or "")[:800]}
        cost, model, seconds = answer.cost, "the development command", answer.seconds
    else:
        run, _tools, cost = live_search._ask(
            job_id, duration, lag, url, lambda searcher: searcher.suggest(most), moments,
            models=[live_agent.IDEAS_MODEL, live_agent.SEARCH_MODEL, live_agent.FALLBACK_MODEL], max_cost=live_agent.IDEAS_MAX_COST, date=meta.get("date"),
        )
        result = {"ideas": clean_ideas(run.ideas, duration, most), "note": run.note}
        model, seconds = run.model, run.seconds
    live_search._keep(path, result)
    logger.info(
        f"[{job_id[:8]}] AI ideas: {len(result['ideas'])} compilations proposed with {model} (~{cost:.4f} $, {seconds:.0f} s): "
        + ", ".join(f"« {idea['title']} » {idea['score']}" for idea in result["ideas"])
    )
    return {**result, "cached": False, "cost": round(cost, 4)}
