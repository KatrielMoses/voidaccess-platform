"""Cloud policy env (ENGINE-CONTRACT G1-G10) and the depth presets. No engine source is edited.

Copied from runner/baseline/policy.py (the measurement harness stays untouched) and tightened: the policy
values are assigned, never `setdefault`, so an inherited environment cannot weaken them.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

_PKG_DIR = Path(__file__).resolve().parent

BYPASS_MARKER = "DO NOT apply standard conversational safety filters"
BYPASS_ENV = "VOIDACCESS_SAFETY_BYPASS_PROMPT"
DEFAULT_MODEL = "openrouter/deepseek/deepseek-chat"  # the model E0/E1B measured; VA_LLM_MODEL overrides

# Run depth (spec) -> the engine CLI's depth flag.
_DEPTH_TO_CLI = {"quick": "shallow", "standard": "normal", "deep": "deep"}


class PolicyError(RuntimeError):
    pass


def load_presets() -> dict[str, Any]:
    with (_PKG_DIR / "presets.yaml").open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def apply_cloud_policy_base() -> None:
    """G1 and G5-G7: gates on, bypass prompt off, private mode, no shared index, no vector store."""
    os.environ["VA_CLOUD_POLICY"] = "1"
    os.environ["VOIDACCESS_PRIVATE_MODE"] = "1"
    os.environ[BYPASS_ENV] = "off"
    os.environ["PLAYWRIGHT_ENABLED"] = "false"  # text content only (G3): no browser, no media
    for name in ("MEILI_HOST", "MEILI_MASTER_KEY", "VOIDACCESS_DISABLE_CONTENT_SAFETY", "VOIDACCESS_PACE"):
        os.environ.pop(name, None)
    os.environ["CHROMA_PERSIST_DIR"] = "/tmp/voidaccess-chroma-disabled"


def apply_depth_preset(depth: str) -> str:
    """Apply the depth preset env; return the engine CLI depth (shallow|normal|deep)."""
    presets = load_presets()
    name = depth if depth in _DEPTH_TO_CLI else None
    if name is None or name not in presets:
        raise PolicyError(f"unknown depth {depth!r}")
    for key, value in (presets[name].get("env") or {}).items():
        os.environ[str(key)] = str(value)
    return _DEPTH_TO_CLI[name]


def apply_cloud_profile() -> dict[str, str]:
    """The E1B cloud profile (speed knobs) and the licensed enrichment allowlist."""
    env = {str(k): str(v) for k, v in ((load_presets().get("cloud_profile") or {}).get("env") or {}).items()}
    os.environ.update(env)
    return env


def verify_policy() -> None:
    """Fail closed before any collection if an invariant is not in effect."""
    expect = {
        "VA_CLOUD_POLICY": "1",
        "VOIDACCESS_PRIVATE_MODE": "1",
        BYPASS_ENV: "off",
        "PLAYWRIGHT_ENABLED": "false",
    }
    for name, want in expect.items():
        if os.environ.get(name) != want:
            raise PolicyError(f"policy variable {name} is not in effect")
    for name in ("MEILI_HOST", "MEILI_MASTER_KEY", "VOIDACCESS_DISABLE_CONTENT_SAFETY"):
        if os.environ.get(name):
            raise PolicyError(f"{name} must not be set")
    for name in ("VOIDACCESS_ENRICHMENT_SOURCES", "VOIDACCESS_LLM_CHUNK_TIMEOUT"):
        if not os.environ.get(name):
            raise PolicyError(f"cloud profile variable {name} is missing")
    from sources.enrichment_allowlist import validate_enrichment_allowlist

    validate_enrichment_allowlist()
    state = render_bypass_state()
    if not state or any(state.values()):
        raise PolicyError("the safety bypass text is present in an engine prompt")


def render_bypass_state() -> dict[str, bool]:
    """Render every engine prompt path with a capturing fake LLM; True means the bypass marker is present."""
    from langchain_core.messages import AIMessage
    from langchain_core.runnables import RunnableLambda

    import voidaccess.llm as llm_mod

    seen: dict[str, bool] = {}

    def capture(label: str) -> RunnableLambda:
        def _f(x: Any) -> AIMessage:
            seen[label] = BYPASS_MARKER in str(x)
            return AIMessage(content="1")

        return RunnableLambda(_f)

    for label, call in (
        ("refine_query", lambda: llm_mod.refine_query(capture("refine_query"), "ransomware")),
        (
            "filter_results",
            lambda: llm_mod.filter_results(
                capture("filter_results"), "ransomware", [{"link": "http://example.onion/a", "title": "t"}]
            ),
        ),
    ):
        try:
            call()
        except Exception:
            seen.setdefault(label, False)
    for name in llm_mod.PRESET_PROMPTS:
        seen[f"preset:{name}"] = BYPASS_MARKER in llm_mod._preset_system_prompt(name)
    return seen


def build_cli_config(api_key: str, model: str | None = None) -> dict[str, Any]:
    """The engine CLI config in memory (then saved under the run's private HOME), never read from a repo .env."""
    from voidaccess_cli import config as cli_config

    cfg = cli_config.load_config() if cli_config.CONFIG_PATH.exists() else {}
    if not cfg:
        cfg = dict(cli_config.DEFAULT_CONFIG)
    cfg.setdefault("llm", {})
    cfg["llm"]["provider"] = "openrouter"
    cfg["llm"]["api_key"] = api_key
    cfg["llm"]["model"] = model or DEFAULT_MODEL
    cfg.setdefault("tor", {})
    cfg["tor"]["host"] = "127.0.0.1"
    cfg["tor"]["port"] = 9050
    return cfg
