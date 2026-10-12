"""Shared locations for the tests (imported as `cloud.tests.paths` is not possible: the tests dir is not a package)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # the platform repo root
VECTORS = Path(__file__).resolve().parent / "vectors" / "engine-client.json"
