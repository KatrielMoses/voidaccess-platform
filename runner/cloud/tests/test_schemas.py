from pathlib import Path

import yaml

from cloud.spec import SCHEMA_DIR


def test_runner_schemas_are_the_engine_client_schemas(repo_root):
    src = repo_root / "packages" / "engine-client" / "schemas"
    names = sorted(p.name for p in src.glob("*.json"))
    assert names and names == sorted(p.name for p in SCHEMA_DIR.glob("*.json"))
    for name in names:
        assert (SCHEMA_DIR / name).read_bytes() == (src / name).read_bytes(), f"{name} is stale: copy it from engine-client"


def test_presets_are_the_baseline_presets(repo_root):
    here = Path(__file__).resolve().parents[1] / "presets.yaml"
    base = repo_root / "runner" / "baseline" / "presets.yaml"
    ours, baseline = yaml.safe_load(here.read_text()), yaml.safe_load(base.read_text())
    # E1C: the cloud deny-list is a runner-only addition (the baseline harness predates it)
    assert ours["cloud_profile"]["env"].pop("VOIDACCESS_DISABLED_SOURCES")
    assert ours == baseline
