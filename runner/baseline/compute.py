"""Cloud Run instance-based compute cost estimate."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CloudRunRates:
    url: str
    vcpu_per_second_usd: float
    gib_per_second_usd: float
    fetched_at: str


def compute_cost_usd(
    duration_s: float,
    vcpu: float,
    memory_gib: float,
    rates: CloudRunRates,
) -> float:
    return (vcpu * duration_s * rates.vcpu_per_second_usd) + (
        memory_gib * duration_s * rates.gib_per_second_usd
    )
