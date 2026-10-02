from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, replace

import httpx

from models import Entity, ExecutionPolicy, HardwareEvidence, ModelOption, PipelineResult, StepLog
from verticals import VERTICALS, VerticalSpec

logger = logging.getLogger("proof-api.routing")

CPU_API_KEY = os.environ.get("CPU_API_KEY", "")
GPU_API_KEY = os.environ.get("GPU_API_KEY", "")
SEMANTIC_ROUTER_URL = os.environ.get("SEMANTIC_ROUTER_URL", "")
MCP_GATEWAY_URL = os.environ.get("MCP_GATEWAY_URL", "")

CPU_HARDWARE_PROVIDER = os.environ.get("CPU_HARDWARE_PROVIDER", "unverified CPU")
GPU_HARDWARE_PROVIDER = os.environ.get("GPU_HARDWARE_PROVIDER", "unverified accelerator")
CPU_INFERENCE_RUNTIME = os.environ.get("CPU_INFERENCE_RUNTIME", "Red Hat AI Inference vllm-cpu-rhel9")
GPU_INFERENCE_RUNTIME = os.environ.get("GPU_INFERENCE_RUNTIME", "Red Hat AI Inference accelerator image")
INFERENCE_TLS_VERIFY = os.environ.get("INFERENCE_TLS_VERIFY", "true").lower() not in {"0", "false", "no"}

@dataclass(frozen=True)
class ModelEndpoint:
    id: str
    label: str
    base_url: str
    provider: str
    runtime: str
    vendor: str = "other"
    product: str = ""
    identity_source: str = "declared"
    support_status: str = "unknown"
    target_id: str = ""


def _endpoint_map(env_name: str, fallback: dict) -> dict[str, ModelEndpoint]:
    raw = os.environ.get(env_name)
    configured = json.loads(raw) if raw else fallback
    return {
        model_id: ModelEndpoint(
            id=model_id,
            label=value.get("label", model_id),
            base_url=value["base_url"],
            provider=value.get("provider", "unverified compute"),
            runtime=value.get("runtime", "Red Hat AI Inference"),
            vendor=value.get("vendor", "other"),
            product=value.get("product", value.get("provider", "unverified compute")),
            identity_source=value.get("identity_source", "declared"),
            support_status=value.get("support_status", "unknown"),
            target_id=value.get("target_id", ""),
        )
        for model_id, value in configured.items()
        if value.get("base_url")
    }


_legacy_cpu_model = os.environ.get("CPU_CLASSIFY_MODEL", "qwen25-3b-cpu")
_legacy_gpu_model = os.environ.get("GPU_MODEL", "granite-3-2-8b-instruct")
CPU_ENDPOINTS = _endpoint_map("CPU_MODEL_ENDPOINTS_JSON", {
    _legacy_cpu_model: {
        "base_url": os.environ.get("CPU_API_BASE", ""),
        "provider": CPU_HARDWARE_PROVIDER,
        "runtime": CPU_INFERENCE_RUNTIME,
    },
})
GPU_ENDPOINTS = _endpoint_map("ACCELERATOR_MODEL_ENDPOINTS_JSON", {
    _legacy_gpu_model: {
        "base_url": os.environ.get("GPU_API_BASE", ""),
        "provider": GPU_HARDWARE_PROVIDER,
        "runtime": GPU_INFERENCE_RUNTIME,
    },
})
DEFAULT_CPU_MODEL = os.environ.get("DEFAULT_CPU_MODEL", next(iter(CPU_ENDPOINTS), ""))
DEFAULT_ACCELERATOR_MODEL = os.environ.get("DEFAULT_ACCELERATOR_MODEL", next(iter(GPU_ENDPOINTS), ""))

_routing_plan_cache: dict[str, dict[str, "Target"]] = {}
_routing_plan_lock = asyncio.Lock()


@dataclass(frozen=True)
class Target:
    hardware: str
    model: str
    provider: str
    runtime: str
    route: str
    method: str
    confidence: float
    router_latency_ms: int


def clear_routing_plan_cache() -> None:
    _routing_plan_cache.clear()


def routing_plan_warmed() -> bool:
    return all(vertical_id in _routing_plan_cache for vertical_id in VERTICALS)


def _cached_routing_plan(vertical_id: str) -> dict[str, Target]:
    return {
        node: replace(target, method=f"{target.method}_cached", router_latency_ms=0)
        for node, target in _routing_plan_cache[vertical_id].items()
    }


async def model_options() -> tuple[list[ModelOption], list[ModelOption]]:
    async def option(item: ModelEndpoint, hardware: str) -> ModelOption:
        available = False
        try:
            async with httpx.AsyncClient(timeout=4, verify=INFERENCE_TLS_VERIFY) as client:
                response = await client.get(f"{item.base_url.rstrip('/')}/v1/models")
                response.raise_for_status()
                available = item.id in {model.get("id") for model in response.json().get("data", [])}
        except Exception:
            pass
        return ModelOption(
            id=item.id, label=item.label, hardware=hardware, provider=item.provider, runtime=item.runtime,
            vendor=item.vendor, product=item.product, identity_source=item.identity_source,
            support_status=item.support_status, target_id=item.target_id, available=available,
        )

    cpu = await asyncio.gather(*(option(item, "cpu") for item in CPU_ENDPOINTS.values()))
    accelerator = await asyncio.gather(*(option(item, "gpu") for item in GPU_ENDPOINTS.values()))
    return list(cpu), list(accelerator)


def resolve_models(cpu_model: str | None, accelerator_model: str | None) -> tuple[str, str]:
    cpu = cpu_model or DEFAULT_CPU_MODEL
    accelerator = accelerator_model or DEFAULT_ACCELERATOR_MODEL
    if cpu not in CPU_ENDPOINTS:
        raise RuntimeError(f"CPU model is not configured: {cpu}")
    if accelerator not in GPU_ENDPOINTS:
        raise RuntimeError(f"accelerator model is not configured: {accelerator}")
    return cpu, accelerator


def _selected_target(target: Target, cpu_model: str, accelerator_model: str) -> Target:
    model = accelerator_model if target.hardware == "gpu" else cpu_model
    endpoint = GPU_ENDPOINTS[model] if target.hardware == "gpu" else CPU_ENDPOINTS[model]
    return replace(target, model=model, provider=endpoint.provider, runtime=endpoint.runtime)


async def routing_plan(policy: ExecutionPolicy, vertical: VerticalSpec, cpu_model: str, accelerator_model: str) -> dict[str, Target]:
    if policy == ExecutionPolicy.cpu_only:
        endpoint = CPU_ENDPOINTS[cpu_model]
        return {node: Target("cpu", cpu_model, endpoint.provider, endpoint.runtime, "forced_cpu", "policy", 1.0, 0) for node in vertical.routing_text}

    if policy == ExecutionPolicy.gpu_only:
        endpoint = GPU_ENDPOINTS[accelerator_model]
        return {node: Target("gpu", accelerator_model, endpoint.provider, endpoint.runtime, "forced_gpu", "policy", 1.0, 0) for node in vertical.routing_text}

    if vertical.id in _routing_plan_cache:
        return {node: _selected_target(target, cpu_model, accelerator_model) for node, target in _cached_routing_plan(vertical.id).items()}

    async with _routing_plan_lock:
        if vertical.id in _routing_plan_cache:
            plan = _cached_routing_plan(vertical.id)
        else:
            plan = await _fetch_heterogeneous_plan(vertical)
            _routing_plan_cache[vertical.id] = plan
        return {node: _selected_target(target, cpu_model, accelerator_model) for node, target in plan.items()}


async def _fetch_heterogeneous_plan(vertical: VerticalSpec) -> dict[str, Target]:
    if not SEMANTIC_ROUTER_URL:
        raise RuntimeError("semantic router is not configured")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{SEMANTIC_ROUTER_URL.rstrip('/')}/classify/batch",
                json={"texts": list(vertical.routing_text.values())},
            )
            response.raise_for_status()
            decisions = response.json().get("results", [])
    except Exception as exc:
        detail = str(exc).strip() or exc.__class__.__name__
        raise RuntimeError(f"semantic router unavailable: {detail}") from exc
    if len(decisions) != len(vertical.routing_text):
        raise RuntimeError("semantic router returned an incomplete plan")

    plan: dict[str, Target] = {}
    for node, decision in zip(vertical.routing_text, decisions):
        hardware = decision.get("hardware", "cpu")
        plan[node] = Target(
            hardware=hardware,
            model="",
            provider=GPU_HARDWARE_PROVIDER if hardware == "gpu" else CPU_HARDWARE_PROVIDER,
            runtime=GPU_INFERENCE_RUNTIME if hardware == "gpu" else CPU_INFERENCE_RUNTIME,
            route=decision.get("route", "unknown"),
            method=decision.get("method", "unknown"),
            confidence=float(decision.get("confidence", 0)),
            router_latency_ms=int(decision.get("latency_ms", 0)),
        )
    return plan


async def warm_routing_plan(retry_seconds: float = 5) -> None:
    """Warm the fixed step-routing plan before a presenter starts the bake-off."""
    if not SEMANTIC_ROUTER_URL or routing_plan_warmed():
        return
    while not routing_plan_warmed():
        try:
            cpu_model, accelerator_model = resolve_models(None, None)
            for vertical in VERTICALS.values():
                if vertical.id not in _routing_plan_cache:
                    await routing_plan(ExecutionPolicy.heterogeneous, vertical, cpu_model, accelerator_model)
            logger.info("Semantic routing plans warmed and cached")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Semantic routing warm-up failed; retrying in %ss: %s", retry_seconds, exc)
            await asyncio.sleep(retry_seconds)


def _extract_json_array(content: str) -> list:
    decoder = json.JSONDecoder()
    candidates = []
    for match in re.finditer(r"\[", content):
        try:
            value, _ = decoder.raw_decode(content[match.start():])
            if isinstance(value, list):
                candidates.append(value)
        except json.JSONDecodeError:
            continue
    return candidates[-1] if candidates else []


def normalize_medication_name(value: str) -> str:
    """Remove a trailing numeric dose before sending a drug name to MCP."""
    return re.split(r"\s+(?=\d)", value.strip(), maxsplit=1)[0].strip(" ,;-")


def _entities_from_content(content: str) -> list[Entity]:
    entities = []
    for item in _extract_json_array(content):
        if not isinstance(item, dict):
            continue
        candidate = item
        if candidate.get("name") and isinstance(candidate.get("arguments"), dict):
            arguments = candidate["arguments"]
            candidate = {
                "text": arguments.get("text"),
                "type": arguments.get("type") or candidate.get("name"),
            }
        if not (candidate.get("text") and candidate.get("type")) and len(candidate) == 1:
            nested = next(iter(candidate.values()))
            candidate = nested if isinstance(nested, dict) else candidate
        if candidate.get("text") and candidate.get("type"):
            entities.append(Entity(text=str(candidate["text"]), type=str(candidate["type"]).casefold()))
    return entities


async def _chat(node: str, target: Target, prompt: str, max_tokens: int) -> StepLog:
    endpoint = GPU_ENDPOINTS[target.model] if target.hardware == "gpu" else CPU_ENDPOINTS[target.model]
    base = endpoint.base_url
    key = GPU_API_KEY if target.hardware == "gpu" else CPU_API_KEY
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=180, verify=INFERENCE_TLS_VERIFY) as client:
        response = await client.post(
            f"{base.rstrip('/')}/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"} if key else {},
            json={
                "model": target.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": max_tokens,
            },
        )
        response.raise_for_status()
        payload = response.json()
    usage = payload.get("usage", {})
    return StepLog(
        node=node,
        model=payload.get("model") or target.model,
        accelerator=target.hardware,
        hardware_provider=target.provider,
        hardware_identity_source=endpoint.identity_source,
        hardware=HardwareEvidence(
            tier="accelerator" if target.hardware == "gpu" else "cpu",
            vendor=endpoint.vendor,
            product=endpoint.product or endpoint.provider,
            identity_source=endpoint.identity_source,
            support_status=endpoint.support_status,
            target_id=endpoint.target_id,
        ),
        inference_runtime=target.runtime,
        route=target.route,
        route_confidence=target.confidence,
        route_method=target.method,
        router_latency_ms=target.router_latency_ms,
        latency_ms=round((time.monotonic() - started) * 1000),
        prompt_tokens=int(usage.get("prompt_tokens", 0)),
        output_tokens=int(usage.get("completion_tokens", 0)),
        prompt=prompt,
        output=payload["choices"][0]["message"]["content"].strip(),
        source_state="live",
    )


async def _call_mcp_tool(tool_name: str, arguments: dict) -> tuple[dict, str]:
    request = {
        "jsonrpc": "2.0",
        "id": "cost-aware-bakeoff",
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    if MCP_GATEWAY_URL:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(f"{MCP_GATEWAY_URL.rstrip('/')}/mcp", json=request)
                response.raise_for_status()
                payload = response.json().get("result", {})
            structured = payload.get("structuredContent") or {}
            if not structured and payload.get("content"):
                structured = json.loads(payload["content"][0]["text"])
            return structured, "live"
        except Exception:
            pass
    return _rehearsal_tool(tool_name, arguments), "rehearsal"


async def _tool_evidence(vertical_id: str, entities: list[Entity]) -> tuple[list[dict], StepLog]:
    started = time.monotonic()
    calls: list[tuple[str, dict]]
    if vertical_id == "healthcare":
        medications = [
            normalized for entity in entities if entity.type == "medication"
            if (normalized := normalize_medication_name(entity.text))
        ]
        calls = [("drug_interaction_check", {"medications": medications})]
    else:
        values = {entity.type: entity.text for entity in entities}
        calls = [
            ("risk_profile_lookup", {"customer_id": values.get("customer_id", "C-1842")}),
            ("regulatory_rule_check", {"transaction_id": values.get("transaction_id", "TX-94721"), "regulation": "aml"}),
            ("sanction_list_search", {"entity_name": values.get("beneficiary", "Northstar Trading")}),
        ]
    responses = await asyncio.gather(*(_call_mcp_tool(name, arguments) for name, arguments in calls))
    evidence = [{"tool": name, "result": response} for (name, _), (response, _) in zip(calls, responses)]
    source = "live" if all(item_source == "live" for _, item_source in responses) else "rehearsal"
    latency = round((time.monotonic() - started) * 1000)
    return evidence, StepLog(
        node="mcp_evidence",
        model="mcp:" + "+".join(name for name, _ in calls),
        accelerator="tool",
        hardware_provider="Red Hat application service",
        hardware_identity_source="not_applicable",
        hardware=HardwareEvidence(
            tier="tool", vendor="not_applicable", product="MCP JSON-RPC",
            identity_source="not_applicable", support_status="not_applicable",
        ),
        inference_runtime="MCP JSON-RPC",
        route="deterministic_tool",
        route_confidence=1,
        route_method="contract",
        router_latency_ms=0,
        latency_ms=latency,
        prompt_tokens=0,
        output_tokens=0,
        prompt=json.dumps([{"tool": name, "arguments": arguments} for name, arguments in calls]),
        output=json.dumps(evidence),
        source_state=source,
    )


def _rehearsal_tool(tool_name: str, arguments: dict) -> dict:
    if tool_name == "risk_profile_lookup":
        return {"customer_id": arguments.get("customer_id", "unknown"), "risk_score": 25, "risk_level": "low", "account_age_days": 730}
    if tool_name == "regulatory_rule_check":
        return {"transaction_id": arguments.get("transaction_id", "unknown"), "regulation": "aml", "status": "pass", "rules_evaluated": 12}
    if tool_name == "sanction_list_search":
        return {"entity_name": arguments.get("entity_name", "unknown"), "matches": [], "screened": True}
    medications = arguments.get("medications", [])
    normalized = {med.casefold(): med for med in medications}
    if "aspirin" in normalized and "clopidogrel" in normalized:
        return {"interactions": [{
            "drug_a": normalized["aspirin"], "drug_b": normalized["clopidogrel"], "severity": "moderate",
            "description": "Dual antiplatelet therapy increases bleeding risk; monitor for bleeding.",
        }]}
    return {"interactions": []}


async def run_pipeline(text: str, policy: ExecutionPolicy, vertical: VerticalSpec, cpu_model: str, accelerator_model: str) -> PipelineResult:
    plan = await routing_plan(policy, vertical, cpu_model, accelerator_model)
    logs = []

    if vertical.id == "healthcare":
        classify_prompt = (
            "Classify this clinical document into exactly one category: discharge_summary, progress_note, "
            "lab_report, radiology_report, pathology_report, surgical_note, consultation, prescription. "
            f"Respond only with the category name.\n\nDocument:\n{text}"
        )
        extract_prompt = (
            "Extract all medications, conditions, and procedures from this clinical document. Return only a JSON array "
            "where each object has text and type.\n\nDocument:\n" + text
        )
    else:
        classify_prompt = (
            "Classify this transaction alert into exactly one category: high_value_wire_alert, sanctions_alert, "
            "account_takeover_alert, card_fraud_alert. Respond only with the category name.\n\nAlert:\n" + text
        )
        extract_prompt = (
            "Extract the customer ID, transaction ID, amount, beneficiary, and destination country. Return only a JSON "
            "array where each object has text and type. Use types customer_id, transaction_id, amount, beneficiary, country.\n\nAlert:\n" + text
        )
    classify = await _chat("classify", plan["classify"], classify_prompt, 32)
    logs.append(classify)
    classification = classify.output.casefold().strip().replace(" ", "_")

    ner = await _chat("extract_entities", plan["extract_entities"], extract_prompt, 512)
    logs.append(ner)
    entities = _entities_from_content(ner.output)

    evidence, evidence_log = await _tool_evidence(vertical.id, entities)
    logs.append(evidence_log)

    context = json.dumps({
        "classification": classification,
        "entities": [entity.model_dump() for entity in entities],
        "tool_evidence": evidence,
    })
    if vertical.id == "healthcare":
        summary_prompt = (
            "Draft a concise physician handoff summary using only the supplied document and structured evidence. "
            "Preserve important diagnoses, procedures, medications, and interaction risk.\n\n"
            f"Structured evidence:\n{context}\n\nDocument:\n{text}"
        )
    else:
        summary_prompt = (
            "Draft a concise fraud analyst recommendation using only the supplied alert and structured evidence. State the "
            "anomaly, customer risk, AML rule result, sanctions result, and whether a human should review it. Do not claim an "
            f"automated decision.\n\nStructured evidence:\n{context}\n\nAlert:\n{text}"
        )
    summary = await _chat("summarize", plan["summarize"], summary_prompt, 256)
    logs.append(summary)

    execution_ms = sum(log.latency_ms for log in logs)
    routing_ms = sum(log.router_latency_ms for log in logs)
    return PipelineResult(
        classification=classification,
        entities=entities,
        tool_evidence=evidence,
        summary=summary.output,
        inference_log=logs,
        execution_ms=execution_ms,
        routing_ms=routing_ms,
        total_ms=execution_ms + routing_ms,
    )
