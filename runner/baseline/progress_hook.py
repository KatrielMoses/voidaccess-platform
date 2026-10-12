"""Per-stage timing and counts from the engine's official progress hook.

Replaces the E0 wrapper around InvestigationDisplay.update_step: a CallbackSink
receives typed ProgressEvents (8 stages, numeric counts), so nothing here depends
on display strings or the Rich display class.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class StageCapture:
    events: list[dict[str, Any]] = field(default_factory=list)
    stage_ms: dict[str, int] = field(default_factory=dict)
    last_counts: dict[str, int] = field(default_factory=dict)
    terminal: str | None = None

    def on_event(self, event: Any) -> None:
        d = event.to_dict()
        self.events.append(
            {k: d[k] for k in ("type", "stage", "status", "seq", "duration_ms", "counts", "reason") if k in d}
        )
        if event.type == "stage" and event.status in ("end", "skipped", "failed") and event.duration_ms is not None:
            self.stage_ms[event.stage.value] = int(event.duration_ms)
        if event.counts:
            self.last_counts = dict(event.counts)
        if event.type in ("completed", "failed", "cancelled"):
            self.terminal = event.type if event.type != "failed" else f"failed:{event.reason}"

    def sink(self) -> Any:
        from progress import CallbackSink

        return CallbackSink(self.on_event)
