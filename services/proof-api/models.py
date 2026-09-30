from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ExecutionPolicy(str, Enum):
    cpu_only = "cpu_only"
    gpu_only = "gpu_only"
    heterogeneous = "heterogeneous"


class CostAssumptions(BaseModel):
    cpu_already_provisioned: bool
    cpu_hourly_usd: float = Field(ge=0)
    gpu_hourly_usd: float = Field(ge=0)


class BakeoffRequest(BaseModel):
    case_id: str = "discharge-stemi-001"
    policies: list[ExecutionPolicy] = Field(default_factory=lambda: list(ExecutionPolicy))
    quality_threshold_pct: float = Field(80, ge=0, le=100)
    cost_assumptions: CostAssumptions


class Entity(BaseModel):
    text: str
    type: str


class StepLog(BaseModel):
    node: str
    model: str
    accelerator: Literal["cpu", "gpu", "tool"]
    hardware_provider: str
    hardware_identity_source: Literal["observed", "declared", "not_applicable"]
    inference_runtime: str
    route: str
    route_confidence: float = Field(ge=0, le=1)
    route_method: str
    router_latency_ms: int = Field(ge=0)
    latency_ms: int = Field(ge=0)
    prompt_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    prompt: str
    output: str
    source_state: Literal["live", "rehearsal"]


class PipelineResult(BaseModel):
    classification: str
    entities: list[Entity]
    drug_interactions: list[dict]
    summary: str
    inference_log: list[StepLog]
    total_ms: int = Field(ge=0)


class EvalComponent(BaseModel):
    name: str
    earned: float = Field(ge=0)
    possible: float = Field(ge=0)
    detail: str


class Evaluation(BaseModel):
    case_id: str
    score_pct: float = Field(ge=0, le=100)
    threshold_pct: float = Field(ge=0, le=100)
    passed: bool
    components: list[EvalComponent]
    scope: str = "This checked-in eval case only"


class ModeledCost(BaseModel):
    cost_per_task_usd: float = Field(ge=0)
    cost_per_1000_tasks_usd: float = Field(ge=0)
    assumptions: CostAssumptions
    method: str = "measured accelerator time multiplied by stated hourly assumptions"


class PolicyRun(BaseModel):
    policy: ExecutionPolicy
    status: Literal["completed", "unavailable", "failed"]
    source_state: Literal["live", "mixed", "unavailable"]
    result: Optional[PipelineResult] = None
    evaluation: Optional[Evaluation] = None
    modeled_cost: Optional[ModeledCost] = None
    error: Optional[str] = None


class BakeoffResponse(BaseModel):
    case_id: str
    case_title: str
    collected_at: str
    policies_run: int = Field(ge=1)
    runs: list[PolicyRun]
