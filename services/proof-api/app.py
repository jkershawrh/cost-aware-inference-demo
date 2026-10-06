from __future__ import annotations

import asyncio
import json
import math
import os
import statistics
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Response, status

import evaluation
from bakery import router as bakery_router
import pipeline
from models import (
    BakeoffRequest, BakeoffResponse, CaseOption, CatalogResponse, ExecutionPolicy,
    PolicyQualificationSummary, PolicyRun, QualificationEnvironment, QualificationJob,
    QualificationManifest, QualificationReport, QualificationRequest, VerticalOption,
)
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

QUALIFICATION_JOBS: dict[str, QualificationJob] = {}
app.include_router(bakery_router)


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


def _environment(vendors: list[str] | None = None) -> QualificationEnvironment:
    return QualificationEnvironment(
        id=os.environ.get("QUALIFICATION_ENVIRONMENT_ID", "unidentified"),
        label=os.environ.get("QUALIFICATION_ENVIRONMENT_LABEL", "Unidentified qualification environment"),
        vendors=vendors or [],
    )


def _json_env(name: str) -> dict:
    try:
        value = json.loads(os.environ.get(name, "{}"))
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _execute_bakeoff(req: BakeoffRequest) -> BakeoffResponse:
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
        environment=_environment(vendors),
        vertical=vertical.id,
        case_id=req.case_id,
        case_title=case["title"],
        collected_at=datetime.now(timezone.utc).isoformat(),
        policies_run=len(runs),
        runs=runs,
    )


@app.post("/api/v1/bakeoff", response_model=BakeoffResponse)
async def bakeoff(req: BakeoffRequest):
    return await _execute_bakeoff(req)


def _percentile_95(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(.95 * len(ordered)) - 1)]


def _qualification_summary(policy: ExecutionPolicy, trials: list[BakeoffResponse]) -> PolicyQualificationSummary:
    runs = [next((run for run in trial.runs if run.policy == policy), None) for trial in trials]
    attempted = len(runs)
    completed = [run for run in runs if run and run.status == "completed" and run.result and run.evaluation and run.modeled_cost]
    execution = [run.result.execution_ms for run in completed]
    quality = [run.evaluation.score_pct for run in completed]
    costs = [run.modeled_cost.cost_per_1000_tasks_usd for run in completed]
    passed = sum(1 for run in completed if run.evaluation.passed)
    live_mcp = sum(1 for run in completed if any(
        step.accelerator == "tool" and step.source_state == "live" for step in run.result.inference_log
    ))
    routing_available = sum(1 for run in completed if all(
        step.route and step.route_method for step in run.result.inference_log if step.accelerator != "tool"
    ))
    return PolicyQualificationSummary(
        policy=policy,
        attempted_runs=attempted,
        completed_runs=len(completed),
        passed_runs=passed,
        pass_rate_pct=round(100 * passed / attempted, 2),
        failure_rate_pct=round(100 * (attempted - len(completed)) / attempted, 2),
        live_mcp_rate_pct=round(100 * live_mcp / attempted, 2),
        routing_available_rate_pct=round(100 * routing_available / attempted, 2),
        median_execution_ms=round(statistics.median(execution), 2) if execution else None,
        p95_execution_ms=_percentile_95(execution),
        median_quality_pct=round(statistics.median(quality), 2) if quality else None,
        minimum_quality_pct=min(quality) if quality else None,
        median_cost_per_1000_tasks_usd=round(statistics.median(costs), 4) if costs else None,
    )


def _manifest(req: QualificationRequest, trials: list[BakeoffResponse]) -> QualificationManifest:
    vendors = sorted({vendor for trial in trials for vendor in trial.environment.vendors})
    return QualificationManifest(
        environment=_environment(vendors),
        framework_revision=os.environ.get("QUALIFICATION_FRAMEWORK_REVISION", "not_recorded"),
        platform=_json_env("QUALIFICATION_PLATFORM_JSON"),
        resource_profile=_json_env("QUALIFICATION_RESOURCE_PROFILE_JSON"),
        cpu_model=req.cpu_model or pipeline.DEFAULT_CPU_MODEL,
        accelerator_model=req.accelerator_model or pipeline.DEFAULT_ACCELERATOR_MODEL,
        case_id=req.case_id,
    )


async def _run_qualification(job_id: str, req: QualificationRequest) -> None:
    job = QUALIFICATION_JOBS[job_id]
    bakeoff_req = BakeoffRequest(**req.model_dump(exclude={"warmup_runs", "measured_runs"}))
    try:
        job.status = "warming"
        for _ in range(req.warmup_runs):
            await _execute_bakeoff(bakeoff_req)
            job.completed_warmup_runs += 1
        job.status = "measuring"
        trials = []
        for _ in range(req.measured_runs):
            trials.append(await _execute_bakeoff(bakeoff_req))
            job.completed_measured_runs += 1
        completed_at = datetime.now(timezone.utc).isoformat()
        job.report = QualificationReport(
            qualification_id=job_id,
            created_at=job.created_at,
            completed_at=completed_at,
            warmup_runs=req.warmup_runs,
            measured_runs=req.measured_runs,
            manifest=_manifest(req, trials),
            summaries=[_qualification_summary(policy, trials) for policy in req.policies],
            trials=trials,
        )
        job.status = "completed"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc).strip() or exc.__class__.__name__


@app.post("/api/v1/qualification", response_model=QualificationJob, status_code=status.HTTP_202_ACCEPTED)
async def start_qualification(req: QualificationRequest):
    if any(job.status in {"queued", "warming", "measuring"} for job in QUALIFICATION_JOBS.values()):
        raise HTTPException(status_code=409, detail="a qualification job is already running in this proof API instance")
    completed = sorted(
        (job for job in QUALIFICATION_JOBS.values() if job.status in {"completed", "failed"}),
        key=lambda job: job.created_at,
    )
    for old_job in completed[:-4]:
        QUALIFICATION_JOBS.pop(old_job.job_id, None)
    job_id = str(uuid4())
    job = QualificationJob(
        job_id=job_id,
        status="queued",
        created_at=datetime.now(timezone.utc).isoformat(),
        warmup_runs=req.warmup_runs,
        measured_runs=req.measured_runs,
        completed_warmup_runs=0,
        completed_measured_runs=0,
    )
    QUALIFICATION_JOBS[job_id] = job
    asyncio.create_task(_run_qualification(job_id, req))
    return job


@app.get("/api/v1/qualification/{job_id}", response_model=QualificationJob)
async def qualification_status(job_id: str, response: Response):
    if job_id not in QUALIFICATION_JOBS:
        raise HTTPException(status_code=404, detail="qualification job not found")
    response.headers["Cache-Control"] = "no-store"
    return QUALIFICATION_JOBS[job_id]
