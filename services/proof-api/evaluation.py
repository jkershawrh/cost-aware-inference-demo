import json
from pathlib import Path

from models import CostAssumptions, EvalComponent, Evaluation, ModeledCost, PipelineResult

CASES = json.loads(Path(__file__).with_name("eval_cases.json").read_text())


def get_case(case_id: str) -> dict:
    if case_id not in CASES:
        raise KeyError(f"unknown evaluation case: {case_id}")
    return CASES[case_id]


def evaluate(case_id: str, result: PipelineResult, threshold_pct: float) -> Evaluation:
    expected = get_case(case_id)["expected"]
    components = []

    classification_ok = result.classification == expected["classification"]
    components.append(EvalComponent(
        name="classification", earned=25 if classification_ok else 0, possible=25,
        detail=f"expected {expected['classification']}; received {result.classification}",
    ))

    actual_entities = {entity.text.casefold() for entity in result.entities}
    expected_entities = {entity.casefold() for entity in expected["entities"]}
    entity_hits = sum(1 for entity in expected_entities if any(entity in actual or actual in entity for actual in actual_entities))
    components.append(EvalComponent(
        name="entity recall", earned=round(30 * entity_hits / max(len(expected_entities), 1), 2), possible=30,
        detail=f"{entity_hits}/{len(expected_entities)} expected entities found",
    ))

    actual_pairs = {
        frozenset((str(item.get("drug_a", "")).casefold(), str(item.get("drug_b", "")).casefold()))
        for item in result.drug_interactions
    }
    expected_pairs = {frozenset(drug.casefold() for drug in pair) for pair in expected["interaction_pairs"]}
    pair_hits = len(actual_pairs & expected_pairs)
    components.append(EvalComponent(
        name="interaction evidence", earned=round(15 * pair_hits / max(len(expected_pairs), 1), 2), possible=15,
        detail=f"{pair_hits}/{len(expected_pairs)} expected interaction pairs found",
    ))

    summary = result.summary.casefold()
    concepts = expected["summary_concepts"]
    concept_hits = sum(1 for concept in concepts if concept.casefold() in summary)
    components.append(EvalComponent(
        name="summary fact coverage", earned=round(30 * concept_hits / max(len(concepts), 1), 2), possible=30,
        detail=f"{concept_hits}/{len(concepts)} required case facts preserved",
    ))

    score = round(sum(component.earned for component in components), 2)
    return Evaluation(
        case_id=case_id,
        score_pct=score,
        threshold_pct=threshold_pct,
        passed=score >= threshold_pct,
        components=components,
    )


def model_cost(result: PipelineResult, assumptions: CostAssumptions) -> ModeledCost:
    cpu_hourly = 0 if assumptions.cpu_already_provisioned else assumptions.cpu_hourly_usd
    total = 0.0
    for step in result.inference_log:
        if step.accelerator == "tool":
            continue
        hourly = assumptions.gpu_hourly_usd if step.accelerator == "gpu" else cpu_hourly
        total += (step.latency_ms / 3_600_000) * hourly
    return ModeledCost(
        cost_per_task_usd=round(total, 6),
        cost_per_1000_tasks_usd=round(total * 1000, 4),
        assumptions=assumptions,
    )
