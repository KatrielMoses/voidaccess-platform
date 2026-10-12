from pathlib import Path

import yaml

from cloud.spec import SCHEMA_DIR
import importlib.util, sys
from pathlib import Path as _P
_spec = importlib.util.spec_from_file_location('va_test_paths', _P(__file__).with_name('paths.py'))
_paths = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_paths)
ROOT = _paths.ROOT


def test_runner_schemas_are_the_engine_client_schemas():
    src = ROOT / "packages" / "engine-client" / "schemas"
    names = sorted(p.name for p in src.glob("*.json"))
    assert names and names == sorted(p.name for p in SCHEMA_DIR.glob("*.json"))
    for name in names:
        assert (SCHEMA_DIR / name).read_bytes() == (src / name).read_bytes(), f"{name} is stale: copy it from engine-client"


def test_presets_are_the_baseline_presets():
    here = Path(__file__).resolve().parents[1] / "presets.yaml"
    base = ROOT / "runner" / "baseline" / "presets.yaml"
    assert yaml.safe_load(here.read_text()) == yaml.safe_load(base.read_text())
