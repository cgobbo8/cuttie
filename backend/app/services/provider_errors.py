"""Provider refusals that no retry or other model will fix: no credits left, a refused key.

Every call of an analysis would fail the same way, so the analysis stops with a
clear message instead of carrying on with the heuristic scores alone (clips
without names, hooks or cuts, and nothing to say why).
"""

import logging

logger = logging.getLogger(__name__)

NAMES = {"openrouter": "OpenRouter", "groq": "Groq"}
MESSAGES = {
    "credits": "Crédits {name} épuisés : recharge ton compte, puis relance l'analyse.",
    "key": "Clé {name} refusée ou manquante : vérifie-la dans les Paramètres, puis relance l'analyse.",
}


class ProviderUnavailable(Exception):
    """The provider refuses every call (reason "credits" or "key")."""

    def __init__(self, provider: str, reason: str) -> None:
        self.provider = provider
        self.reason = reason
        super().__init__(MESSAGES[reason].format(name=NAMES.get(provider, provider)))


def fatal_reason(err: BaseException) -> str | None:
    """ "credits" for HTTP 402, "key" for 401, else None (rate limits, timeouts and
    one-off errors are worth a retry or a fallback)."""
    if isinstance(err, ProviderUnavailable):
        return err.reason
    status = getattr(err, "status_code", None)
    if status is None:
        status = getattr(getattr(err, "response", None), "status_code", None)
    if status == 402:
        return "credits"
    if status == 401:
        return "key"
    return None


def stop_if_fatal(err: BaseException, provider: str = "openrouter") -> None:
    """Raise ProviderUnavailable when `err` means every call to `provider` will fail."""
    if isinstance(err, ProviderUnavailable):
        raise err
    reason = fatal_reason(err)
    if reason:
        raise ProviderUnavailable(provider, reason) from err


def check_openrouter() -> str | None:
    """Ask OpenRouter for one token: None when it answers, "credits" / "key" when
    it refuses for good. Network trouble or anything else counts as fine (the
    analysis will tell). Costs a fraction of a cent.

    (The account balance itself needs a management key: /api/v1/credits.)
    """
    from app.services.openai_client import LLM_MODEL, get_openrouter_client

    try:
        get_openrouter_client().chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": "ok"}],
            max_tokens=1,
            timeout=20,
        )
    except Exception as e:
        reason = fatal_reason(e)
        if not reason:
            logger.info(f"OpenRouter check inconclusive: {e}")
        return reason
    return None


def openrouter_credit() -> dict | None:
    """What's left on the OpenRouter key when it has a spending limit (free to
    ask): {"remaining": dollars, "limit": dollars}, else None."""
    import httpx

    from app.services import settings

    key = settings.get("openrouter_api_key", "OPENROUTER_API_KEY")
    if not key:
        return None
    try:
        response = httpx.get("https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {key}"}, timeout=10)
        data = response.json().get("data") or {}
    except Exception as e:
        logger.info(f"OpenRouter credit unknown: {e}")
        return None
    if data.get("limit") is None or data.get("limit_remaining") is None:
        return None
    return {"remaining": round(float(data["limit_remaining"]), 2), "limit": round(float(data["limit"]), 2)}
