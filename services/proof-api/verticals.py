from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VerticalSpec:
    id: str
    label: str
    description: str
    routing_text: dict[str, str]


VERTICALS = {
    "healthcare": VerticalSpec(
        id="healthcare",
        label="Healthcare",
        description="Clinical document triage with medication evidence and a physician handoff.",
        routing_text={
            "classify": "Classify one clinical document into exactly one short category label.",
            "extract_entities": "Extract medications, conditions, and procedures into structured JSON.",
            "summarize": "Synthesize clinical findings, procedures, medications, interactions, and risks into a physician handoff.",
        },
    ),
    "financial_services": VerticalSpec(
        id="financial_services",
        label="Financial Services",
        description="Transaction alert triage with customer risk, regulatory, and sanctions evidence.",
        routing_text={
            "classify": "Classify one transaction alert into exactly one short investigation category.",
            "extract_entities": "Extract customer, transaction, beneficiary, country, and risk facts into structured JSON.",
            "summarize": "Synthesize transaction facts, customer risk, regulatory checks, and sanctions evidence into an analyst recommendation.",
        },
    ),
}


def get_vertical(vertical_id: str) -> VerticalSpec:
    try:
        return VERTICALS[vertical_id]
    except KeyError as exc:
        raise KeyError(f"unknown vertical: {vertical_id}") from exc
