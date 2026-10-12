import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # runner/


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def vectors() -> dict:
    return json.loads((Path(__file__).parent / "vectors" / "engine-client.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _clean_scrub():
    from cloud import scrub

    scrub.clear()
    yield
    scrub.clear()
