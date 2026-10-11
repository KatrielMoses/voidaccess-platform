"""Per-call LLM token accounting for parallel runs (no shared-key usage delta needed).

`install_usage_recording()` wraps `voidaccess.llm.get_llm` so every LLM object the
engine builds carries a callback that records prompt/completion tokens per call.
Cost = tokens x the live per-token price of the exact model id from OpenRouter /models.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

import httpx
from langchain_core.callbacks import BaseCallbackHandler

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
MODELS_FETCH_TIMEOUT_S = 30.0
OPENROUTER_ID_PREFIX = "openrouter/"


@dataclass
class ModelPrice:
    model_id: str
    prompt_usd_per_token: float
    completion_usd_per_token: float


def fetch_price_table() -> dict[str, ModelPrice]:
    """Live per-token list prices for every model OpenRouter lists."""
    with httpx.Client(timeout=MODELS_FETCH_TIMEOUT_S) as client:
        data = client.get(OPENROUTER_MODELS_URL).json().get("data") or []
    table: dict[str, ModelPrice] = {}
    for entry in data:
        pricing = entry.get("pricing") or {}
        table[entry["id"]] = ModelPrice(
            entry["id"],
            float(pricing.get("prompt") or 0.0),
            float(pricing.get("completion") or 0.0),
        )
    return table


@dataclass
class UsageRecorder(BaseCallbackHandler):
    """LangChain callback; thread-safe because extraction runs concurrently."""

    calls: list[dict[str, Any]] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        usage: dict[str, Any] = {}
        model = ""
        out = getattr(response, "llm_output", None) or {}
        usage = dict(out.get("token_usage") or {})
        model = out.get("model_name") or out.get("model") or ""
        if not usage:
            for gens in getattr(response, "generations", None) or []:
                for gen in gens:
                    meta = getattr(getattr(gen, "message", None), "usage_metadata", None) or {}
                    if meta:
                        usage = {
                            "prompt_tokens": meta.get("input_tokens", 0),
                            "completion_tokens": meta.get("output_tokens", 0),
                        }
        record = {
            "model": model,
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "provider_cost_usd": usage.get("cost"),  # present when OpenRouter reports it
        }
        with self._lock:
            self.calls.append(record)

    def summarize(self, configured_model: str) -> dict[str, Any]:
        table = fetch_price_table()
        fallback = table.get(configured_model.removeprefix(OPENROUTER_ID_PREFIX))
        with self._lock:
            calls = list(self.calls)
        total = 0.0
        unpriced = 0
        prices_used: dict[str, dict[str, float]] = {}
        for call in calls:
            served = (call["model"] or "").removeprefix(OPENROUTER_ID_PREFIX)
            price = table.get(served) or fallback
            if price is None:
                call["est_cost_usd"] = None
                unpriced += 1
                continue
            call["priced_as"] = price.model_id
            call["est_cost_usd"] = (
                call["prompt_tokens"] * price.prompt_usd_per_token
                + call["completion_tokens"] * price.completion_usd_per_token
            )
            total += call["est_cost_usd"]
            prices_used[price.model_id] = {
                "prompt_usd_per_token": price.prompt_usd_per_token,
                "completion_usd_per_token": price.completion_usd_per_token,
            }
        provider_costs = [c["provider_cost_usd"] for c in calls if c["provider_cost_usd"] is not None]
        return {
            "configured_model": configured_model,
            "prices_used": prices_used,
            "price_source": OPENROUTER_MODELS_URL,
            "calls": calls,
            "llm_calls": len(calls),
            "unpriced_calls": unpriced,
            "prompt_tokens": sum(c["prompt_tokens"] for c in calls),
            "completion_tokens": sum(c["completion_tokens"] for c in calls),
            "est_cost_usd": total if calls and not unpriced else (total if calls else 0.0),
            "provider_reported_cost_usd": sum(provider_costs) if provider_costs else None,
        }


def install_usage_recording(recorder: UsageRecorder) -> None:
    """Wrap voidaccess.llm.get_llm so each LLM it returns reports to `recorder`."""
    import voidaccess.llm as llm_mod

    original = llm_mod.get_llm
    if getattr(original, "_usage_wrapped", False):
        return

    def wrapped(*args: Any, **kwargs: Any) -> Any:
        llm = original(*args, **kwargs)
        existing = list(getattr(llm, "callbacks", None) or [])
        llm.callbacks = existing + [recorder]
        return llm

    wrapped._usage_wrapped = True  # type: ignore[attr-defined]
    llm_mod.get_llm = wrapped
