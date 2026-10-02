import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError

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
        tool_evidence=[{"tool": "drug_interaction_check", "result": {"interactions": [{"drug_a": "Aspirin", "drug_b": "Clopidogrel", "severity": "moderate"}]}}],
        summary="STEMI treated with PCI; continue Aspirin and Clopidogrel.",
        inference_log=[models.StepLog(
            node="summarize", model="model", accelerator=hardware, route="test", route_confidence=1,
            hardware_provider="Intel Xeon" if hardware == "cpu" else "NVIDIA GPU",
            hardware_identity_source="declared", inference_runtime="Red Hat AI Inference",
            hardware=models.HardwareEvidence(
                tier="cpu" if hardware == "cpu" else "accelerator",
                vendor="intel" if hardware == "cpu" else "nvidia",
                product="Xeon" if hardware == "cpu" else "GPU",
                identity_source="declared", support_status="supported",
            ),
            route_method="test", router_latency_ms=0, latency_ms=600, prompt_tokens=10, output_tokens=10,
            prompt="in", output="out", source_state="live",
        )],
        execution_ms=600, routing_ms=0, total_ms=600,
    )


def test_eval_is_case_scoped():
    scored = evaluation.evaluate("discharge-stemi-001", result(), 80)
    assert scored.score_pct == 100
    assert scored.passed
    assert "case" in scored.scope


def test_eval_explains_a_partial_score_with_the_missing_case_fact():
    partial = result()
    partial.summary = "STEMI treated with PCI; continue Aspirin."
    scored = evaluation.evaluate("discharge-stemi-001", partial, 80)
    assert scored.score_pct == 92.5
    summary_component = next(component for component in scored.components if component.name == "summary fact coverage")
    assert summary_component.earned == 22.5
    assert "missing: Clopidogrel" in summary_component.detail


def test_cost_uses_visible_assumptions():
    assumptions = models.CostAssumptions(cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36)
    assert evaluation.model_cost(result("cpu"), assumptions).cost_per_1000_tasks_usd == 0
    assert evaluation.model_cost(result("gpu"), assumptions).cost_per_1000_tasks_usd == pytest.approx(6, abs=.0001)


def test_financial_services_eval_is_scoped_to_its_case():
    financial = result()
    financial.classification = "high_value_wire_alert"
    financial.entities = [
        models.Entity(text="C-1842", type="customer_id"), models.Entity(text="TX-94721", type="transaction_id"),
        models.Entity(text="$48,750", type="amount"), models.Entity(text="Northstar Trading", type="beneficiary"),
        models.Entity(text="Estonia", type="country"),
    ]
    financial.tool_evidence = [
        {"tool": "risk_profile_lookup", "result": {"risk_level": "low"}},
        {"tool": "regulatory_rule_check", "result": {"regulation": "aml", "status": "pass"}},
        {"tool": "sanction_list_search", "result": {"screened": True, "matches": []}},
    ]
    financial.summary = "Review the $48,750 wire to Northstar Trading in Estonia. Human review is required."
    scored = evaluation.evaluate("wire-alert-001", financial, 80)
    assert scored.score_pct == 100
    assert scored.passed


@pytest.mark.asyncio
async def test_catalog_exposes_only_configured_model_endpoints(monkeypatch):
    import app
    import pipeline

    monkeypatch.setattr(pipeline, "CPU_ENDPOINTS", {
        "cpu-a": pipeline.ModelEndpoint("cpu-a", "CPU A", "http://cpu-a", "Intel Xeon", "Red Hat AI Inference"),
        "cpu-b": pipeline.ModelEndpoint("cpu-b", "CPU B", "http://cpu-b", "Intel Xeon", "Red Hat AI Inference"),
    })
    monkeypatch.setattr(pipeline, "GPU_ENDPOINTS", {
        "gaudi-a": pipeline.ModelEndpoint("gaudi-a", "Gaudi A", "http://gaudi-a", "Intel Gaudi", "Red Hat AI Inference"),
    })
    response = await app.catalog()
    assert [model.id for model in response.cpu_models] == ["cpu-a", "cpu-b"]
    assert [model.id for model in response.accelerator_models] == ["gaudi-a"]
    assert {vertical.id for vertical in response.verticals} == {"healthcare", "financial_services"}


def test_medication_names_are_normalized_before_mcp_lookup():
    import pipeline

    assert pipeline.normalize_medication_name("Aspirin 81mg") == "Aspirin"
    assert pipeline.normalize_medication_name("Metformin 500 mg twice daily") == "Metformin"
    assert pipeline.normalize_medication_name("Vitamin B12") == "Vitamin B12"


def test_json_array_is_recovered_from_verbose_model_output():
    import pipeline

    output = '''I used this example: [not valid].\n```json\n[{"text":"C-1842","type":"customer_id"}]\n```'''
    assert pipeline._extract_json_array(output) == [{"text": "C-1842", "type": "customer_id"}]


def test_nested_entity_shape_is_normalized_at_the_contract_boundary():
    import pipeline

    output = '```json\n[{"customer_id":{"text":"C-1842","type":"customer_id"}}]\n```'
    assert pipeline._entities_from_content(output) == [models.Entity(text="C-1842", type="customer_id")]


def test_function_style_entity_shape_is_normalized_at_the_contract_boundary():
    import pipeline

    output = '''[
      {"name":"Medication","arguments":{"text":"Metformin 500mg"}},
      {"name":"Condition","arguments":{"text":"Type 2 Diabetes"}},
      {"name":"Procedure","arguments":{"text":"STEMI with PCI to RCA"}}
    ]'''
    assert pipeline._entities_from_content(output) == [
        models.Entity(text="Metformin 500mg", type="medication"),
        models.Entity(text="Type 2 Diabetes", type="condition"),
        models.Entity(text="STEMI with PCI to RCA", type="procedure"),
    ]


@pytest.mark.asyncio
async def test_bakeoff_runs_all_policies_in_parallel():
    import app

    active = 0
    peak = 0

    async def fake_pipeline(_text, policy, _vertical, _cpu_model, _accelerator_model):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(.01)
        active -= 1
        return result("gpu" if policy == models.ExecutionPolicy.gpu_only else "cpu")

    request = models.BakeoffRequest(
        cost_assumptions=models.CostAssumptions(cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36),
    )
    with patch.object(app.pipeline, "resolve_models", return_value=("cpu-model", "gpu-model")), patch.object(app.pipeline, "run_pipeline", new=AsyncMock(side_effect=fake_pipeline)):
        response = await app.bakeoff(request)
    assert peak == 3
    assert response.policies_run == 3
    assert all(run.result and run.result.summary for run in response.runs)


@pytest.mark.asyncio
async def test_heterogeneous_routing_plan_is_cached(monkeypatch):
    import pipeline

    pipeline.clear_routing_plan_cache()
    calls = 0

    async def fake_fetch_plan(vertical):
        nonlocal calls
        calls += 1
        return {
            node: pipeline.Target(
                hardware="gpu" if node == "summarize" else "cpu",
                model="model",
                provider="provider",
                runtime="runtime",
                route="complex" if node == "summarize" else "simple",
                method="embedding",
                confidence=.9,
                router_latency_ms=1200,
            )
            for node in vertical.routing_text
        }

    cpu_endpoint = pipeline.ModelEndpoint("cpu-model", "CPU", "http://cpu", "Intel Xeon", "Red Hat AI Inference")
    gpu_endpoint = pipeline.ModelEndpoint("gpu-model", "GPU", "http://gpu", "Intel Gaudi", "Red Hat AI Inference")
    monkeypatch.setitem(pipeline.CPU_ENDPOINTS, "cpu-model", cpu_endpoint)
    monkeypatch.setitem(pipeline.GPU_ENDPOINTS, "gpu-model", gpu_endpoint)
    monkeypatch.setattr(pipeline, "_fetch_heterogeneous_plan", fake_fetch_plan)
    from verticals import VERTICALS
    vertical = VERTICALS["healthcare"]
    first = await pipeline.routing_plan(models.ExecutionPolicy.heterogeneous, vertical, "cpu-model", "gpu-model")
    second = await pipeline.routing_plan(models.ExecutionPolicy.heterogeneous, vertical, "cpu-model", "gpu-model")

    assert calls == 1
    assert first["summarize"].router_latency_ms == 1200
    assert second["summarize"].router_latency_ms == 0
    assert second["summarize"].method == "embedding_cached"
    pipeline.clear_routing_plan_cache()


@pytest.mark.asyncio
async def test_missing_gpu_is_explicitly_unavailable():
    import app

    async def fake_pipeline(_text, policy, _vertical, _cpu_model, _accelerator_model):
        if policy == models.ExecutionPolicy.gpu_only:
            raise RuntimeError("GPU tier is not configured")
        return result()

    request = models.BakeoffRequest(
        cost_assumptions=models.CostAssumptions(cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36),
    )
    with patch.object(app.pipeline, "resolve_models", return_value=("cpu-model", "gpu-model")), patch.object(app.pipeline, "run_pipeline", new=AsyncMock(side_effect=fake_pipeline)):
        response = await app.bakeoff(request)
    gpu = next(run for run in response.runs if run.policy == models.ExecutionPolicy.gpu_only)
    assert gpu.status == "unavailable"
    assert gpu.result is None


def test_legacy_gpu_hourly_input_is_accepted_but_serializes_provider_neutrally():
    assumptions = models.CostAssumptions.model_validate({
        "cpu_already_provisioned": False,
        "cpu_hourly_usd": 4,
        "gpu_hourly_usd": 36,
    })
    assert assumptions.accelerator_hourly_usd == 36
    assert "accelerator_hourly_usd" in assumptions.model_dump()
    assert "gpu_hourly_usd" not in assumptions.model_dump()


def test_response_declares_single_environment_evidence_scope():
    response = models.BakeoffResponse(
        vertical="healthcare", case_id="discharge-stemi-001", case_title="case",
        collected_at="2026-10-02T00:00:00Z", policies_run=1,
        runs=[models.PolicyRun(policy=models.ExecutionPolicy.cpu_only, status="completed", source_state="live", result=result())],
    )
    payload = response.model_dump(mode="json")
    assert payload["schema_version"] == "placement-evidence/v1"
    assert payload["comparison_kind"] == "policy_plus_model"
    assert payload["measurement_scope"] == "single_environment"
    assert payload["routing_behavior"] == "warmed_workflow_plan"
    assert payload["quality_scope"] == "named_case_only"
    assert payload["environment"]["collection_mode"] == "live_single_environment"
    assert payload["runs"][0]["result"]["inference_log"][0]["hardware"]["vendor"] == "intel"


@pytest.mark.asyncio
async def test_bakeoff_records_the_current_environment_and_observed_vendor_set(monkeypatch):
    import app

    request = models.BakeoffRequest(
        policies=[models.ExecutionPolicy.cpu_only],
        cost_assumptions=models.CostAssumptions(
            cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36,
        ),
    )
    monkeypatch.setenv("QUALIFICATION_ENVIRONMENT_ID", "intel-reference")
    monkeypatch.setenv("QUALIFICATION_ENVIRONMENT_LABEL", "Intel reference environment")
    with patch.object(app.pipeline, "resolve_models", return_value=("cpu-model", "gpu-model")), patch.object(app.pipeline, "run_pipeline", new=AsyncMock(return_value=result())):
        response = await app.bakeoff(request)
    assert response.environment.id == "intel-reference"
    assert response.environment.label == "Intel reference environment"
    assert response.environment.vendors == ["intel"]


def test_response_satisfies_versioned_placement_evidence_contract():
    response = models.BakeoffResponse(
        vertical="healthcare", case_id="discharge-stemi-001", case_title="case",
        collected_at="2026-10-02T00:00:00Z", policies_run=1,
        runs=[models.PolicyRun(
            policy=models.ExecutionPolicy.cpu_only, status="completed", source_state="live",
            result=result(), evaluation=evaluation.evaluate("discharge-stemi-001", result(), 80),
            modeled_cost=evaluation.model_cost(result(), models.CostAssumptions(
                cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36,
            )),
        )],
    )
    schema_path = Path(__file__).parents[3] / "contracts" / "schemas" / "placement-evidence-v1.json"
    schema = json.loads(schema_path.read_text())
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(response.model_dump(mode="json"))


def qualification_trial(execution_ms: int, score: float = 100, source: str = "live"):
    pipeline_result = result()
    pipeline_result.execution_ms = execution_ms
    pipeline_result.total_ms = execution_ms
    pipeline_result.inference_log[0].source_state = source
    evaluated = evaluation.evaluate("discharge-stemi-001", pipeline_result, 80)
    evaluated.score_pct = score
    evaluated.passed = score >= 80
    return models.BakeoffResponse(
        environment=models.QualificationEnvironment(id="intel-reference", label="Intel", vendors=["intel"]),
        vertical="healthcare", case_id="discharge-stemi-001", case_title="case",
        collected_at="2026-10-02T00:00:00Z", policies_run=1,
        runs=[models.PolicyRun(
            policy=models.ExecutionPolicy.cpu_only, status="completed", source_state="live",
            result=pipeline_result, evaluation=evaluated,
            modeled_cost=evaluation.model_cost(pipeline_result, models.CostAssumptions(
                cpu_already_provisioned=False, cpu_hourly_usd=4, accelerator_hourly_usd=36,
            )),
        )],
    )


def test_qualification_summary_reports_median_p95_quality_and_source_consistency():
    import app

    trials = [qualification_trial(value) for value in [100, 200, 300, 400, 1000]]
    summary = app._qualification_summary(models.ExecutionPolicy.cpu_only, trials)
    assert summary.attempted_runs == 5
    assert summary.completed_runs == 5
    assert summary.pass_rate_pct == 100
    assert summary.failure_rate_pct == 0
    assert summary.live_mcp_rate_pct == 0  # This unit fixture has no MCP step.
    assert summary.routing_available_rate_pct == 100
    assert summary.median_execution_ms == 300
    assert summary.p95_execution_ms == 1000
    assert summary.minimum_quality_pct == 100


@pytest.mark.asyncio
async def test_qualification_runs_warmups_then_measured_trials_and_validates_contract(monkeypatch):
    import app

    calls = 0

    async def fake_bakeoff(_request):
        nonlocal calls
        calls += 1
        return qualification_trial(100 * calls)

    request = models.QualificationRequest(
        policies=[models.ExecutionPolicy.cpu_only], warmup_runs=1, measured_runs=3,
        cost_assumptions=models.CostAssumptions(
            cpu_already_provisioned=False, cpu_hourly_usd=4, accelerator_hourly_usd=36,
        ),
    )
    job_id = "8d749e42-4197-4c9d-b5f0-b33a297cdf5c"
    app.QUALIFICATION_JOBS[job_id] = models.QualificationJob(
        job_id=job_id, status="queued", created_at="2026-10-02T00:00:00Z",
        warmup_runs=1, measured_runs=3, completed_warmup_runs=0, completed_measured_runs=0,
    )
    monkeypatch.setattr(app, "_execute_bakeoff", fake_bakeoff)
    await app._run_qualification(job_id, request)

    job = app.QUALIFICATION_JOBS[job_id]
    assert calls == 4
    assert job.status == "completed"
    assert job.completed_warmup_runs == 1
    assert job.completed_measured_runs == 3
    assert [trial.runs[0].result.execution_ms for trial in job.report.trials] == [200, 300, 400]
    schema_path = Path(__file__).parents[3] / "contracts" / "schemas" / "qualification-evidence-v1.json"
    schema = json.loads(schema_path.read_text())
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(job.report.model_dump(mode="json"))


def test_qualification_request_bounds_repetition_count():
    with pytest.raises(ValidationError):
        models.QualificationRequest(
            measured_runs=31,
            cost_assumptions=models.CostAssumptions(
                cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36,
            ),
        )


@pytest.mark.asyncio
async def test_qualification_rejects_concurrent_job_to_protect_measurement_integrity():
    import app
    from fastapi import HTTPException

    app.QUALIFICATION_JOBS.clear()
    active_id = "f3b44c49-3f02-4934-a815-7b97db25206e"
    app.QUALIFICATION_JOBS[active_id] = models.QualificationJob(
        job_id=active_id, status="measuring", created_at="2026-10-02T00:00:00Z",
        warmup_runs=1, measured_runs=10, completed_warmup_runs=1, completed_measured_runs=2,
    )
    request = models.QualificationRequest(cost_assumptions=models.CostAssumptions(
        cpu_already_provisioned=True, cpu_hourly_usd=4, accelerator_hourly_usd=36,
    ))
    with pytest.raises(HTTPException) as exc:
        await app.start_qualification(request)
    assert exc.value.status_code == 409
    app.QUALIFICATION_JOBS.clear()
