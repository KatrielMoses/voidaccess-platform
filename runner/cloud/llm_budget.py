"""Per-call LLM token accounting plus the per-run token budget (guarantee 6).

`install_usage_recording()` wraps `voidaccess.llm.get_llm` so every LLM object the engine builds carries
a callback handler. The handler records prompt and completion tokens per call (priced afterwards from the
live OpenRouter price list) and, once the run's token budget is spent, raises `BudgetExceeded` before each
further call. The engine treats a failed LLM call like any other provider failure: it falls back to its
non-LLM paths and the fallback summary. The check is made when a call starts, so calls already in flight
(at most the extraction concurrency) can overshoot the budget by their own size.

Copied from runner/baseline/llm_usage.py (the measurement harness stays untouched), plus the budget guard.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

import httpx
from langchain_core.callbacks import BaseCallbackHandler

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
MODELS_FETCH_TIMEOUT_S = 15.0
OPENROUTER_ID_PREFIX = "openrouter/"
# List price of deepseek/deepseek-chat on openrouter.ai/api/v1/models, read 2026-10-12. Used only when the
# live price list cannot be fetched at the end of a run.
FALLBACK_PROMPT_USD_PER_TOKEN = 0.00000032
FALLBACK_COMPLETION_USD_PER_TOKEN = 0.00000089


class BudgetExceeded(RuntimeError):
    """The run's LLM token budget is spent; raised instead of making another call."""


@dataclass
class ModelPrice:
    model_id: str
    prompt_usd_per_token: float
    completion_usd_per_token: float


def fetch_price_table() -> dict[str, ModelPrice]:
    with httpx.Client(timeout=MODELS_FETCH_TIMEOUT_S) as client:
        data = client.get(OPENROUTER_MODELS_URL).json().get("data") or []
    table: dict[str, ModelPrice] = {}
    for entry in data:
        pricing = entry.get("pricing") or {}
        table[entry["id"]] = ModelPrice(
            entry["id"], float(pricing.get("prompt") or 0.0), float(pricing.get("completion") or 0.0)
        )
    return table


@dataclass
class UsageRecorder(BaseCallbackHandler):
    """LangChain callback; thread-safe because extraction runs concurrently."""

    token_budget: int | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)
    refused: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # Let BudgetExceeded reach the caller instead of being logged and swallowed by LangChain.
    raise_error: bool = True

    @property
    def tokens_spent(self) -> int:
        with self._lock:
            return sum(c["prompt_tokens"] + c["completion_tokens"] for c in self.calls)

    def _check_budget(self) -> None:
        if self.token_budget is None:
            return
        if self.tokens_spent >= self.token_budget:
            with self._lock:
                self.refused += 1
            raise BudgetExceeded("LLM token budget spent")

    def on_llm_start(self, serialized: Any, prompts: Any, **kwargs: Any) -> None:
        self._check_budget()

    def on_chat_model_start(self, serialized: Any, messages: Any, **kwargs: Any) -> None:
        self._check_budget()

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
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

    def totals(self) -> dict[str, int]:
        with self._lock:
            calls = list(self.calls)
        return {
            "llm_calls": len(calls),
            "prompt_tokens": sum(c["prompt_tokens"] for c in calls),
            "completion_tokens": sum(c["completion_tokens"] for c in calls),
        }

    def estimate_cost_usd(self, configured_model: str, table: dict[str, ModelPrice] | None = None) -> float:
        """Tokens x the list price of the model that served each call (a conservative upper bound: E0 found
        billed cost about 20% lower)."""
        if table is None:
            try:
                table = fetch_price_table()
            except Exception:
                table = {}
        fallback = table.get(configured_model.removeprefix(OPENROUTER_ID_PREFIX)) or ModelPrice(
            configured_model, FALLBACK_PROMPT_USD_PER_TOKEN, FALLBACK_COMPLETION_USD_PER_TOKEN
        )
        with self._lock:
            calls = list(self.calls)
        total = 0.0
        for call in calls:
            price = table.get((call["model"] or "").removeprefix(OPENROUTER_ID_PREFIX)) or fallback
            total += (
                call["prompt_tokens"] * price.prompt_usd_per_token
                + call["completion_tokens"] * price.completion_usd_per_token
            )
        return total


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
