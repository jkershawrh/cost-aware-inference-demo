from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, replace

import httpx

from models import Entity, ExecutionPolicy, PipelineResult, StepLog

logger = logging.getLogger("proof-api.routing")

CPU_API_BASE = os.environ.get("CPU_API_BASE", "")
CPU_API_KEY = os.environ.get("CPU_API_KEY", "")
GPU_API_BASE = os.environ.get("GPU_API_BASE", "")
GPU_API_KEY = os.environ.get("GPU_API_KEY", "")
SEMANTIC_ROUTER_URL = os.environ.get("SEMANTIC_ROUTER_URL", "")
MCP_GATEWAY_URL = os.environ.get("MCP_GATEWAY_URL", "")

CPU_MODELS = {
    "classify": os.environ.get("CPU_CLASSIFY_MODEL", "qwen25-3b-cpu"),
    "extract_entities": os.environ.get("CPU_NER_MODEL", "granite-2b-cpu"),
    "summarize": os.environ.get("CPU_SUMMARY_MODEL", "qwen25-3b-cpu"),
}
GPU_MODEL = os.environ.get("GPU_MODEL", "granite-3-2-8b-instruct")
CPU_HARDWARE_PROVIDER = os.environ.get("CPU_HARDWARE_PROVIDER", "unverified CPU")
GPU_HARDWARE_PROVIDER = os.environ.get("GPU_HARDWARE_PROVIDER", "unverified accelerator")
CPU_INFERENCE_RUNTIME = os.environ.get("CPU_INFERENCE_RUNTIME", "Red Hat AI Inference vllm-cpu-rhel9")
GPU_INFERENCE_RUNTIME = os.environ.get("GPU_INFERENCE_RUNTIME", "Red Hat AI Inference accelerator image")
INFERENCE_TLS_VERIFY = os.environ.get("INFERENCE_TLS_VERIFY", "true").lower() not in {"0", "false", "no"}

ROUTING_TEXT = {
    "classify": "Classify one clinical document into exactly one short category label.",
    "extract_entities": "Extract medications, conditions, and procedures into structured JSON.",
    "summarize": "Synthesize clinical findings, procedures, medications, interactions, and risks into a physician handoff.",
}

_routing_plan_cache: dict[str, "Target"] | None = None
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
    global _routing_plan_cache
    _routing_plan_cache = None


def routing_plan_warmed() -> bool:
    return _routing_plan_cache is not None


def _cached_routing_plan() -> dict[str, Target]:
    assert _routing_plan_cache is not None
    return {
        node: replace(target, method=f"{target.method}_cached", router_latency_ms=0)
        for node, target in _routing_plan_cache.items()
    }


async def routing_plan(policy: ExecutionPolicy) -> dict[str, Target]:
    global _routing_plan_cache
    if policy == ExecutionPolicy.cpu_only:
        if not CPU_API_BASE:
            raise RuntimeError("CPU tier is not configured")
        return {node: Target("cpu", model, CPU_HARDWARE_PROVIDER, CPU_INFERENCE_RUNTIME, "forced_cpu", "policy", 1.0, 0) for node, model in CPU_MODELS.items()}

    if policy == ExecutionPolicy.gpu_only:
        if not GPU_API_BASE:
            raise RuntimeError("GPU tier is not configured")
        return {node: Target("gpu", GPU_MODEL, GPU_HARDWARE_PROVIDER, GPU_INFERENCE_RUNTIME, "forced_gpu", "policy", 1.0, 0) for node in ROUTING_TEXT}

    if _routing_plan_cache is not None:
        return _cached_routing_plan()

    async with _routing_plan_lock:
        if _routing_plan_cache is not None:
            return _cached_routing_plan()
        plan = await _fetch_heterogeneous_plan()
        _routing_plan_cache = plan
        return plan


async def _fetch_heterogeneous_plan() -> dict[str, Target]:
    if not SEMANTIC_ROUTER_URL:
        raise RuntimeError("semantic router is not configured")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{SEMANTIC_ROUTER_URL.rstrip('/')}/classify/batch",
                json={"texts": list(ROUTING_TEXT.values())},
            )
            response.raise_for_status()
            decisions = response.json().get("results", [])
    except Exception as exc:
        detail = str(exc).strip() or exc.__class__.__name__
        raise RuntimeError(f"semantic router unavailable: {detail}") from exc
    if len(decisions) != len(ROUTING_TEXT):
        raise RuntimeError("semantic router returned an incomplete plan")

    plan: dict[str, Target] = {}
    for node, decision in zip(ROUTING_TEXT, decisions):
        hardware = decision.get("hardware", "cpu")
        if hardware == "gpu" and not GPU_API_BASE:
            raise RuntimeError(f"router selected GPU for {node}, but GPU tier is not configured")
        if hardware == "cpu" and not CPU_API_BASE:
            raise RuntimeError(f"router selected CPU for {node}, but CPU tier is not configured")
        plan[node] = Target(
            hardware=hardware,
            model=decision.get("model") or (GPU_MODEL if hardware == "gpu" else CPU_MODELS[node]),
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
            await routing_plan(ExecutionPolicy.heterogeneous)
            logger.info("Semantic routing plan warmed and cached")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Semantic routing warm-up failed; retrying in %ss: %s", retry_seconds, exc)
            await asyncio.sleep(retry_seconds)


def _extract_json_array(content: str) -> list:
    start = content.find("[")
    end = content.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        value = json.loads(content[start:end + 1])
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def normalize_medication_name(value: str) -> str:
    """Remove a trailing numeric dose before sending a drug name to MCP."""
    return re.split(r"\s+(?=\d)", value.strip(), maxsplit=1)[0].strip(" ,;-")


async def _chat(node: str, target: Target, prompt: str, max_tokens: int) -> StepLog:
    base = GPU_API_BASE if target.hardware == "gpu" else CPU_API_BASE
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
        hardware_identity_source="declared",
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


async def _interactions(medications: list[str]) -> tuple[list[dict], StepLog]:
    request = {
        "jsonrpc": "2.0",
        "id": "cost-aware-bakeoff",
        "method": "tools/call",
        "params": {"name": "drug_interaction_check", "arguments": {"medications": medications}},
    }
    started = time.monotonic()
    if MCP_GATEWAY_URL:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(f"{MCP_GATEWAY_URL.rstrip('/')}/mcp", json=request)
                response.raise_for_status()
                payload = response.json().get("result", {})
            structured = payload.get("structuredContent") or {}
            if not structured and payload.get("content"):
                structured = json.loads(payload["content"][0]["text"])
            interactions = structured.get("interactions", [])
            source = "live"
        except Exception:
            interactions = _rehearsal_interactions(medications)
            source = "rehearsal"
    else:
        interactions = _rehearsal_interactions(medications)
        source = "rehearsal"
    latency = round((time.monotonic() - started) * 1000)
    return interactions, StepLog(
        node="check_interactions",
        model="mcp:drug_interaction_check",
        accelerator="tool",
        hardware_provider="Red Hat application service",
        hardware_identity_source="not_applicable",
        inference_runtime="MCP JSON-RPC",
        route="deterministic_tool",
        route_confidence=1,
        route_method="contract",
        router_latency_ms=0,
        latency_ms=latency,
        prompt_tokens=0,
        output_tokens=0,
        prompt=json.dumps(request["params"]["arguments"]),
        output=json.dumps(interactions),
        source_state=source,
    )


def _rehearsal_interactions(medications: list[str]) -> list[dict]:
    normalized = {med.casefold(): med for med in medications}
    if "aspirin" in normalized and "clopidogrel" in normalized:
        return [{
            "drug_a": normalized["aspirin"],
            "drug_b": normalized["clopidogrel"],
            "severity": "moderate",
            "description": "Dual antiplatelet therapy increases bleeding risk; monitor for bleeding.",
        }]
    return []


async def run_pipeline(text: str, policy: ExecutionPolicy) -> PipelineResult:
    plan = await routing_plan(policy)
    logs = []

    classify_prompt = (
        "Classify this clinical document into exactly one category: discharge_summary, progress_note, "
        "lab_report, radiology_report, pathology_report, surgical_note, consultation, prescription. "
        f"Respond only with the category name.\n\nDocument:\n{text}"
    )
    classify = await _chat("classify", plan["classify"], classify_prompt, 32)
    logs.append(classify)
    classification = classify.output.casefold().strip().replace(" ", "_")

    ner_prompt = (
        "Extract all medications, conditions, and procedures from this clinical document. Return only a JSON array "
        "where each object has text and type.\n\nDocument:\n" + text
    )
    ner = await _chat("extract_entities", plan["extract_entities"], ner_prompt, 512)
    logs.append(ner)
    entities = [
        Entity(text=str(item["text"]), type=str(item["type"]).casefold())
        for item in _extract_json_array(ner.output)
        if isinstance(item, dict) and item.get("text") and item.get("type")
    ]

    medications = [
        normalized
        for entity in entities
        if entity.type == "medication"
        if (normalized := normalize_medication_name(entity.text))
    ]
    interactions, interaction_log = await _interactions(medications)
    logs.append(interaction_log)

    context = json.dumps({
        "classification": classification,
        "entities": [entity.model_dump() for entity in entities],
        "drug_interactions": interactions,
    })
    summary_prompt = (
        "Draft a concise physician handoff summary using only the supplied document and structured evidence. "
        "Preserve important diagnoses, procedures, medications, and interaction risk.\n\n"
        f"Structured evidence:\n{context}\n\nDocument:\n{text}"
    )
    summary = await _chat("summarize", plan["summarize"], summary_prompt, 256)
    logs.append(summary)

    return PipelineResult(
        classification=classification,
        entities=entities,
        drug_interactions=interactions,
        summary=summary.output,
        inference_log=logs,
        total_ms=sum(log.latency_ms + log.router_latency_ms for log in logs),
    )
