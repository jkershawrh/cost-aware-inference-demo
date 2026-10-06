import pytest
from fastapi.testclient import TestClient

from app import app
from models import BakeoffRequest
from verticals import get_vertical


def test_bakery_is_an_explicit_workload():
    assert BakeoffRequest(vertical="food_manufacturing", case_id="bakery-batch-001", cost_assumptions={"cpu_already_provisioned": True, "cpu_hourly_usd": 4, "accelerator_hourly_usd": 36}).vertical == "food_manufacturing"
    assert get_vertical("food_manufacturing").label == "Food Manufacturing"


def test_bakery_mcp_returns_versioned_synthetic_evidence():
    with TestClient(app) as client:
        response = client.post("/bakery/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "bakery_batch_evidence", "arguments": {"batch_id": "B-204"}}})
    evidence = response.json()["result"]["structuredContent"]
    assert evidence["data_origin"] == "synthetic_demo"
    assert evidence["procedure_id"] == "BAKE-QA-01/v1"
    assert evidence["observed_temperature_c"] == 168
    assert evidence["target_temperature_c"] == 180
    assert evidence["action_authority"] == "human_review_required"


def test_bakery_mcp_rejects_unknown_batch():
    with TestClient(app) as client:
        response = client.post("/bakery/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "bakery_batch_evidence", "arguments": {"batch_id": "unknown"}}})
    assert response.json()["error"]["code"] == -32602


@pytest.mark.asyncio
async def test_bakery_pipeline_uses_extracted_batch_and_scoped_evaluation(monkeypatch):
    import json
    import evaluation
    import pipeline
    from models import ExecutionPolicy, StepLog
    from unittest.mock import AsyncMock
    from bakery import EVIDENCE

    case = evaluation.CASES["bakery-batch-001"]
    outputs = {
        "classify": "batch_quality_alert",
        "extract_entities": json.dumps([{"text": value, "type": "batch_id" if value == "B-204" else "observation"} for value in case["expected"]["entities"]]),
        "summarize": "Synthetic batch B-204: 168 C vs 180 C. Human review required under BAKE-QA-01/v1; cause unconfirmed.",
    }
    async def chat(node, plan, prompt, tokens):
        return StepLog(node=node, model="test", accelerator="cpu", hardware_provider="test", hardware_identity_source="declared", inference_runtime="test", hardware={"tier": "cpu", "vendor": "intel", "product": "test", "identity_source": "declared", "support_status": "supported"}, route="test", route_confidence=1, route_method="test", router_latency_ms=0, latency_ms=1, prompt_tokens=1, output_tokens=1, prompt=prompt, output=outputs[node], source_state="live")
    monkeypatch.setattr(pipeline, "routing_plan", AsyncMock(return_value={key: {} for key in outputs}))
    monkeypatch.setattr(pipeline, "_chat", chat)
    tool = AsyncMock(return_value=(EVIDENCE, "live"))
    monkeypatch.setattr(pipeline, "_call_mcp_tool", tool)
    result = await pipeline.run_pipeline(case["text"], ExecutionPolicy.cpu_only, get_vertical("food_manufacturing"), "cpu", "gpu")
    tool.assert_awaited_once_with("bakery_batch_evidence", {"batch_id": "B-204"})
    assert evaluation.evaluate("bakery-batch-001", result, 80).score_pct == 100
    assert "synthetic incident" in result.inference_log[-1].prompt


@pytest.mark.asyncio
async def test_bakery_does_not_invent_missing_batch():
    import pipeline
    with pytest.raises(ValueError, match="batch_id"):
        await pipeline._tool_evidence("food_manufacturing", [])


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["B-204", "Batch B-204", " batch b-204 "])
async def test_batch_identifier_label_is_normalized(monkeypatch, text):
    import pipeline
    from models import Entity
    from unittest.mock import AsyncMock
    tool = AsyncMock(return_value=({"data_origin": "synthetic_demo"}, "live"))
    monkeypatch.setattr(pipeline, "_call_mcp_tool", tool)
    await pipeline._tool_evidence("food_manufacturing", [Entity(text=text, type="batch_id")])
    tool.assert_awaited_once_with("bakery_batch_evidence", {"batch_id": "B-204"})
