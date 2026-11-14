"""One-off text calls to the AI: searching the live, planning a video, cutting a clip.

OpenRouter with the analysis' model, like the rest. In development,
CUTTIE_LLM_CMD names a command that reads the prompt on stdin and prints the
answer (e.g. `claude -p --model sonnet --tools ""`): the features can be tried
with an equivalent model without spending OpenRouter credits.
"""

import logging
import os
import shlex
import subprocess
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Dollars per million tokens of the analysis' model (Gemini 3 Flash Preview on OpenRouter):
# what the app says a call costs before making it
PRICE_IN = float(os.getenv("LLM_PRICE_IN", "0.5"))
PRICE_OUT = float(os.getenv("LLM_PRICE_OUT", "3"))
# French text: about 3.3 characters per token
CHARS_PER_TOKEN = 3.3
CMD_TIMEOUT = 15 * 60


@dataclass
class Answer:
    text: str
    tokens_in: int
    tokens_out: int
    # Dollars, from the tokens used (0 with the development command)
    cost: float
    seconds: float


def estimate_tokens(text: str) -> int:
    return int(len(text) / CHARS_PER_TOKEN)


def estimate_cost(prompt_chars: int, answer_tokens: int = 5000) -> float:
    """Dollars a call would cost: the prompt read once, an answer of `answer_tokens` (thinking included)."""
    return round(prompt_chars / CHARS_PER_TOKEN * PRICE_IN / 1e6 + answer_tokens * PRICE_OUT / 1e6, 4)


def dev_command() -> str:
    return os.getenv("CUTTIE_LLM_CMD", "").strip()


def complete(prompt: str, max_tokens: int = 16000, temperature: float = 0.3) -> Answer:
    """The AI's answer to `prompt`. OpenRouter refusing for good (credits, key)
    raises ProviderUnavailable; anything else propagates."""
    t0 = time.time()
    command = dev_command()
    if command:
        done = subprocess.run(shlex.split(command), input=prompt, capture_output=True, text=True, timeout=CMD_TIMEOUT)
        if done.returncode != 0:
            raise RuntimeError(f"CUTTIE_LLM_CMD failed ({done.returncode}): {(done.stderr or done.stdout)[-300:]}")
        answer = Answer(done.stdout, estimate_tokens(prompt), estimate_tokens(done.stdout), 0.0, time.time() - t0)
        logger.info(f"AI text call (dev command): ~{answer.tokens_in} tokens in, ~{answer.tokens_out} out, {answer.seconds:.0f} s")
        return answer

    from app.services.openai_client import LLM_MODEL, get_openrouter_client
    from app.services.provider_errors import stop_if_fatal

    try:
        response = get_openrouter_client().chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            # Gemini's thinking tokens count toward this limit
            max_completion_tokens=max_tokens,
            timeout=300,
        )
    except Exception as e:
        stop_if_fatal(e)
        raise
    usage = getattr(response, "usage", None)
    tokens_in = int(getattr(usage, "prompt_tokens", 0) or estimate_tokens(prompt))
    text = response.choices[0].message.content or ""
    tokens_out = int(getattr(usage, "completion_tokens", 0) or estimate_tokens(text))
    answer = Answer(text, tokens_in, tokens_out, round(tokens_in * PRICE_IN / 1e6 + tokens_out * PRICE_OUT / 1e6, 4), time.time() - t0)
    logger.info(f"AI text call: {tokens_in} tokens in, {tokens_out} out (~{answer.cost:.3f} $), {answer.seconds:.0f} s")
    return answer


def parse_json(content: str) -> dict:
    """The JSON object in an answer (code fences and prose around it dropped)."""
    import json
    import re

    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    match = re.search(r"\{.*\}", content, re.DOTALL)
    data = json.loads(match.group(0) if match else content)
    if not isinstance(data, dict):
        raise ValueError("the AI's answer is not a JSON object")
    return data
