import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

import evaluation
import pipeline
from models import BakeoffRequest, BakeoffResponse, CaseOption, CatalogResponse, ExecutionPolicy, PolicyRun, QualificationEnvironment, VerticalOption
from verticals import VERTICALS, get_vertical


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warm_task = asyncio.create_task(pipeline.warm_routing_plan())
    try:
        yield
    finally:
        warm_task.cancel()
        await asyncio.gather(warm_task, return_exceptions=True)

app = FastAPI(
    title="Cost-Aware Inference Proof API",
    version="0.1.0",
    description="Runs one industry task through CPU-only, accelerator-only, and heterogeneous policies without changing the application contract.",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "cpu_configured": bool(pipeline.CPU_ENDPOINTS),
        "gpu_configured": bool(pipeline.GPU_ENDPOINTS),
        "semantic_router_configured": bool(pipeline.SEMANTIC_ROUTER_URL),
        "semantic_router_warmed": pipeline.routing_plan_warmed(),
        "mcp_configured": bool(pipeline.MCP_GATEWAY_URL),
        "cpu_hardware_provider": pipeline.CPU_HARDWARE_PROVIDER,
        "gpu_hardware_provider": pipeline.GPU_HARDWARE_PROVIDER,
        "hardware_identity_source": "declared",
    }


@app.get("/api/v1/eval-cases")
async def eval_cases():
    return [{"id": case_id, "title": case["title"], "vertical": case["vertical"]} for case_id, case in evaluation.CASES.items()]


@app.get("/api/v1/catalog", response_model=CatalogResponse)
async def catalog():
    cpu_models, accelerator_models = await pipeline.model_options()
    verticals = [VerticalOption(
        id=vertical.id,
        label=vertical.label,
        description=vertical.description,
        cases=[CaseOption(id=case_id, title=case["title"]) for case_id, case in evaluation.CASES.items() if case["vertical"] == vertical.id],
    ) for vertical in VERTICALS.values()]
    return CatalogResponse(verticals=verticals, cpu_models=cpu_models, accelerator_models=accelerator_models)


@app.post("/api/v1/bakeoff", response_model=BakeoffResponse)
async def bakeoff(req: BakeoffRequest):
    try:
        vertical = get_vertical(req.vertical)
        case = evaluation.get_case(req.case_id)
        if case["vertical"] != vertical.id:
            raise KeyError(f"case {req.case_id} does not belong to vertical {vertical.id}")
        cpu_model, accelerator_model = pipeline.resolve_models(req.cpu_model, req.accelerator_model)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    async def run(policy: ExecutionPolicy) -> PolicyRun:
        try:
            result = await pipeline.run_pipeline(case["text"], policy, vertical, cpu_model, accelerator_model)
            source = "live" if all(step.source_state == "live" for step in result.inference_log) else "mixed"
            return PolicyRun(
                policy=policy,
                status="completed",
                source_state=source,
                result=result,
                evaluation=evaluation.evaluate(req.case_id, result, req.quality_threshold_pct),
                modeled_cost=evaluation.model_cost(result, req.cost_assumptions),
            )
        except RuntimeError as exc:
            return PolicyRun(policy=policy, status="unavailable", source_state="unavailable", error=str(exc))
        except Exception as exc:
            detail = str(exc).strip() or exc.__class__.__name__
            return PolicyRun(policy=policy, status="failed", source_state="unavailable", error=detail)

    runs = await asyncio.gather(*(run(policy) for policy in req.policies))
    vendors = sorted({
        step.hardware.vendor
        for policy_run in runs if policy_run.result
        for step in policy_run.result.inference_log
        if step.hardware.vendor != "not_applicable"
    })
    return BakeoffResponse(
        environment=QualificationEnvironment(
            id=os.environ.get("QUALIFICATION_ENVIRONMENT_ID", "unidentified"),
            label=os.environ.get("QUALIFICATION_ENVIRONMENT_LABEL", "Unidentified qualification environment"),
            vendors=vendors,
        ),
        vertical=vertical.id,
        case_id=req.case_id,
        case_title=case["title"],
        collected_at=datetime.now(timezone.utc).isoformat(),
        policies_run=len(runs),
        runs=runs,
    )
