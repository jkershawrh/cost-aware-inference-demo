import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

import evaluation
import pipeline
from models import BakeoffRequest, BakeoffResponse, ExecutionPolicy, PolicyRun


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warm_task = asyncio.create_task(pipeline.warm_routing_plan())
    try:
        yield
    finally:
        warm_task.cancel()
        await asyncio.gather(warm_task, return_exceptions=True)

app = FastAPI(
    title="Cost-Aware Healthcare Inference Proof API",
    version="0.1.0",
    description="Runs one healthcare task through CPU-only, GPU-only, and heterogeneous policies without changing the application contract.",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "cpu_configured": bool(pipeline.CPU_API_BASE),
        "gpu_configured": bool(pipeline.GPU_API_BASE),
        "semantic_router_configured": bool(pipeline.SEMANTIC_ROUTER_URL),
        "semantic_router_warmed": pipeline.routing_plan_warmed(),
        "mcp_configured": bool(pipeline.MCP_GATEWAY_URL),
        "cpu_hardware_provider": pipeline.CPU_HARDWARE_PROVIDER,
        "gpu_hardware_provider": pipeline.GPU_HARDWARE_PROVIDER,
        "hardware_identity_source": "declared",
    }


@app.get("/api/v1/eval-cases")
async def eval_cases():
    return [{"id": case_id, "title": case["title"]} for case_id, case in evaluation.CASES.items()]


@app.post("/api/v1/bakeoff", response_model=BakeoffResponse)
async def bakeoff(req: BakeoffRequest):
    try:
        case = evaluation.get_case(req.case_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def run(policy: ExecutionPolicy) -> PolicyRun:
        try:
            result = await pipeline.run_pipeline(case["text"], policy)
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
    return BakeoffResponse(
        case_id=req.case_id,
        case_title=case["title"],
        collected_at=datetime.now(timezone.utc).isoformat(),
        policies_run=len(runs),
        runs=runs,
    )
