"""Proof: observe CLI stage progress by wrapping InvestigationDisplay."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class ProgressCapture:
    events: list[dict[str, str]] = field(default_factory=list)

    def record(self, step: str, status: str, detail: str = "") -> None:
        self.events.append({"step": step, "status": status, "detail": detail[:200]})


def install_display_hook(capture: ProgressCapture) -> Callable[[], None]:
    """Patch voidaccess_cli.display.InvestigationDisplay.update_step."""
    import voidaccess_cli.display as display_mod

    original = display_mod.InvestigationDisplay.update_step

    def patched(self, step_name: str, status: str, detail: str = "") -> Any:
        capture.record(step_name, status, detail)
        return original(self, step_name, status, detail)

    display_mod.InvestigationDisplay.update_step = patched  # type: ignore[method-assign]

    def restore() -> None:
        display_mod.InvestigationDisplay.update_step = original  # type: ignore[method-assign]

    return restore
