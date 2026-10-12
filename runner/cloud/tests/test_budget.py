import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from cloud.llm_budget import BudgetExceeded, UsageRecorder, install_usage_recording


def reply(tokens_in, tokens_out):
    return AIMessage(
        content="ok",
        usage_metadata={"input_tokens": tokens_in, "output_tokens": tokens_out, "total_tokens": tokens_in + tokens_out},
    )


def model(recorder, *replies):
    return GenericFakeChatModel(messages=iter(replies), callbacks=[recorder])


def test_calls_are_recorded_until_the_budget_is_spent_then_refused():
    rec = UsageRecorder(token_budget=100)
    llm = model(rec, reply(50, 30), reply(50, 30), reply(5, 5))
    llm.invoke("a")
    llm.invoke("b")  # 80 spent < 100: allowed, and it takes the total to 160
    assert rec.tokens_spent == 160
    with pytest.raises(BudgetExceeded):
        llm.invoke("c")
    assert rec.refused == 1 and rec.totals() == {"llm_calls": 2, "prompt_tokens": 100, "completion_tokens": 60}


def test_no_budget_means_no_limit():
    rec = UsageRecorder()
    llm = model(rec, *[reply(1000, 1000) for _ in range(5)])
    for _ in range(5):
        llm.invoke("x")
    assert rec.totals()["llm_calls"] == 5 and rec.refused == 0


def test_the_budget_error_reaches_the_caller_so_the_engine_can_fall_back():
    rec = UsageRecorder(token_budget=1)
    llm = model(rec, reply(5, 5), reply(5, 5))
    llm.invoke("first")
    with pytest.raises(BudgetExceeded) as e:
        llm.invoke("second")
    assert isinstance(e.value, RuntimeError)  # an ordinary Exception: the engine's `except Exception` paths catch it


def test_cost_estimate_uses_the_price_table_or_the_documented_fallback():
    rec = UsageRecorder()
    model(rec, reply(1_000_000, 1_000_000)).invoke("x")
    assert rec.estimate_cost_usd("openrouter/deepseek/deepseek-chat", table={}) == pytest.approx(0.00000032 * 1e6 + 0.00000089 * 1e6)


def test_install_wraps_get_llm_once(monkeypatch):
    llm_mod = pytest.importorskip("voidaccess.llm", reason="engine tree not on PYTHONPATH")

    class Fake:
        callbacks = None

    monkeypatch.setattr(llm_mod, "get_llm", lambda *a, **k: Fake())
    rec = UsageRecorder()
    install_usage_recording(rec)
    install_usage_recording(rec)
    got = llm_mod.get_llm("m")
    assert got.callbacks == [rec]
