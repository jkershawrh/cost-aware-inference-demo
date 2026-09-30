import asyncio
from unittest.mock import AsyncMock, patch

import pytest

import evaluation
import models


def result(hardware="cpu"):
    entities = [
        "Type 2 Diabetes", "Metformin", "Lisinopril", "STEMI", "PCI",
        "Aspirin", "Clopidogrel", "hypertension", "CKD",
    ]
    return models.PipelineResult(
        classification="discharge_summary",
        entities=[models.Entity(text=value, type="medication" if value in {"Metformin", "Lisinopril", "Aspirin", "Clopidogrel"} else "condition") for value in entities],
        drug_interactions=[{"drug_a": "Aspirin", "drug_b": "Clopidogrel", "severity": "moderate"}],
        summary="STEMI treated with PCI; continue Aspirin and Clopidogrel.",
        inference_log=[models.StepLog(
            node="summarize", model="model", accelerator=hardware, route="test", route_confidence=1,
            hardware_provider="Intel Xeon" if hardware == "cpu" else "NVIDIA GPU",
            hardware_identity_source="declared", inference_runtime="Red Hat AI Inference",
            route_method="test", router_latency_ms=0, latency_ms=600, prompt_tokens=10, output_tokens=10,
            prompt="in", output="out", source_state="live",
        )],
        total_ms=600,
    )


def test_eval_is_case_scoped():
    scored = evaluation.evaluate("discharge-stemi-001", result(), 80)
    assert scored.score_pct == 100
    assert scored.passed
    assert "case" in scored.scope


def test_cost_uses_visible_assumptions():
    assumptions = models.CostAssumptions(cpu_already_provisioned=True, cpu_hourly_usd=4, gpu_hourly_usd=36)
    assert evaluation.model_cost(result("cpu"), assumptions).cost_per_1000_tasks_usd == 0
    assert evaluation.model_cost(result("gpu"), assumptions).cost_per_1000_tasks_usd == pytest.approx(6, abs=.0001)


def test_medication_names_are_normalized_before_mcp_lookup():
    import pipeline

    assert pipeline.normalize_medication_name("Aspirin 81mg") == "Aspirin"
    assert pipeline.normalize_medication_name("Metformin 500 mg twice daily") == "Metformin"
    assert pipeline.normalize_medication_name("Vitamin B12") == "Vitamin B12"


@pytest.mark.asyncio
async def test_bakeoff_runs_all_policies_in_parallel():
    import app

    active = 0
    peak = 0

    async def fake_pipeline(_text, policy):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(.01)
        active -= 1
        return result("gpu" if policy == models.ExecutionPolicy.gpu_only else "cpu")

    request = models.BakeoffRequest(
        cost_assumptions=models.CostAssumptions(cpu_already_provisioned=True, cpu_hourly_usd=4, gpu_hourly_usd=36),
    )
    with patch.object(app.pipeline, "run_pipeline", new=AsyncMock(side_effect=fake_pipeline)):
        response = await app.bakeoff(request)
    assert peak == 3
    assert response.policies_run == 3
    assert all(run.result and run.result.summary for run in response.runs)


@pytest.mark.asyncio
async def test_missing_gpu_is_explicitly_unavailable():
    import app

    async def fake_pipeline(_text, policy):
        if policy == models.ExecutionPolicy.gpu_only:
            raise RuntimeError("GPU tier is not configured")
        return result()

    request = models.BakeoffRequest(
        cost_assumptions=models.CostAssumptions(cpu_already_provisioned=True, cpu_hourly_usd=4, gpu_hourly_usd=36),
    )
    with patch.object(app.pipeline, "run_pipeline", new=AsyncMock(side_effect=fake_pipeline)):
        response = await app.bakeoff(request)
    gpu = next(run for run in response.runs if run.policy == models.ExecutionPolicy.gpu_only)
    assert gpu.status == "unavailable"
    assert gpu.result is None
