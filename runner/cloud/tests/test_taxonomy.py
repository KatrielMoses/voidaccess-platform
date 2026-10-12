import re

import pytest

from cloud.taxonomy import ALIASES, TYPE_CATEGORY, is_secret_type, is_sensitive_type, normalize_type
import importlib.util, sys
from pathlib import Path as _P
_spec = importlib.util.spec_from_file_location('va_test_paths', _P(__file__).with_name('paths.py'))
_paths = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_paths)
ROOT = _paths.ROOT

ENTITIES_TS = ROOT / "packages" / "engine-client" / "src" / "entities.ts"


def _ts_taxonomy() -> dict[str, str]:
    src = ENTITIES_TS.read_text(encoding="utf-8")
    block = src[src.index("const TYPE_CATEGORY = {") : src.index("} as const satisfies")]
    return dict(re.findall(r"^\s+([A-Z][A-Z_0-9]+): \"(\w+)\"", block, re.M))


def test_matches_engine_client_taxonomy():
    assert TYPE_CATEGORY == _ts_taxonomy()


def test_sensitivity_rules_match_engine_client():
    assert is_secret_type("API_KEY") and is_secret_type("CRYPTO_SEED_PHRASE") and not is_secret_type("EMAIL_ADDRESS")
    for t in ("EMAIL_ADDRESS", "PHONE_NUMBER", "PERSON_NAME", "GITHUB_TOKEN"):
        assert is_sensitive_type(t)
    assert not is_sensitive_type("CVE_NUMBER") and not is_sensitive_type("BITCOIN_ADDRESS")


def test_aliases_land_in_the_taxonomy():
    assert all(v in TYPE_CATEGORY for v in ALIASES.values())
    assert normalize_type("phone") == "PHONE_NUMBER" and normalize_type("NOT_A_TYPE") is None


def test_every_engine_extractor_type_is_mapped():
    normalizer = pytest.importorskip("extractor.normalizer", reason="engine tree not on PYTHONPATH")
    unmapped = [t for t in normalizer.TYPE_PRIORITY if normalize_type(t) is None]
    assert unmapped == []
