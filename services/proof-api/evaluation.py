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

    normalize = lambda value: "".join(character for character in value.casefold() if character.isalnum())
    actual_entities = {normalize(entity.text) for entity in result.entities}
    expected_entities = {normalize(entity) for entity in expected["entities"]}
    entity_hits = sum(1 for entity in expected_entities if any(entity in actual or actual in entity for actual in actual_entities))
    missing_entities = [entity for entity in expected["entities"] if not any(normalize(entity) in actual or actual in normalize(entity) for actual in actual_entities)]
    components.append(EvalComponent(
        name="entity recall", earned=round(30 * entity_hits / max(len(expected_entities), 1), 2), possible=30,
        detail=f"{entity_hits}/{len(expected_entities)} expected entities found" + (f"; missing: {', '.join(missing_entities)}" if missing_entities else ""),
    ))

    evidence_text = json.dumps(result.tool_evidence).casefold()
    expected_terms = [term.casefold() for term in expected["evidence_terms"]]
    evidence_hits = sum(1 for term in expected_terms if term in evidence_text)
    missing_evidence = [term for term in expected["evidence_terms"] if term.casefold() not in evidence_text]
    components.append(EvalComponent(
        name="tool evidence", earned=round(15 * evidence_hits / max(len(expected_terms), 1), 2), possible=15,
        detail=f"{evidence_hits}/{len(expected_terms)} required evidence terms found" + (f"; missing: {', '.join(missing_evidence)}" if missing_evidence else ""),
    ))

    summary = result.summary.casefold()
    concepts = expected["summary_concepts"]
    concept_hits = sum(1 for concept in concepts if concept.casefold() in summary)
    missing_concepts = [concept for concept in concepts if concept.casefold() not in summary]
    components.append(EvalComponent(
        name="summary fact coverage", earned=round(30 * concept_hits / max(len(concepts), 1), 2), possible=30,
        detail=f"{concept_hits}/{len(concepts)} required case facts preserved" + (f"; missing: {', '.join(missing_concepts)}" if missing_concepts else ""),
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
