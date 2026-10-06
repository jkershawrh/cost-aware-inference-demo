from enum import Enum
from typing import Literal, Optional
from uuid import uuid4

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ExecutionPolicy(str, Enum):
    cpu_only = "cpu_only"
    gpu_only = "gpu_only"
    heterogeneous = "heterogeneous"


class CostAssumptions(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cpu_already_provisioned: bool
    cpu_hourly_usd: float = Field(ge=0)
    accelerator_hourly_usd: float = Field(
        ge=0,
        validation_alias=AliasChoices("accelerator_hourly_usd", "gpu_hourly_usd"),
        description="Hourly assumption for the selected accelerator; accepts legacy gpu_hourly_usd input.",
    )


class BakeoffRequest(BaseModel):
    vertical: Literal["healthcare", "financial_services", "food_manufacturing"] = "healthcare"
    case_id: str = "discharge-stemi-001"
    cpu_model: Optional[str] = None
    accelerator_model: Optional[str] = None
    policies: list[ExecutionPolicy] = Field(default_factory=lambda: list(ExecutionPolicy), min_length=1, max_length=3)
    quality_threshold_pct: float = Field(80, ge=0, le=100)
    cost_assumptions: CostAssumptions


class QualificationRequest(BakeoffRequest):
    warmup_runs: int = Field(1, ge=0, le=5)
    measured_runs: int = Field(10, ge=1, le=30)


class Entity(BaseModel):
    text: str
    type: str


class HardwareEvidence(BaseModel):
    tier: Literal["cpu", "accelerator", "tool"]
    vendor: Literal["intel", "amd", "nvidia", "other", "not_applicable"]
    product: str
    identity_source: Literal["observed", "declared", "not_applicable"]
    support_status: Literal["supported", "technology_preview", "unknown", "not_applicable"]
    target_id: str = ""


class StepLog(BaseModel):
    node: str
    model: str
    accelerator: Literal["cpu", "gpu", "tool"]
    hardware_provider: str
    hardware_identity_source: Literal["observed", "declared", "not_applicable"]
    hardware: HardwareEvidence
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
    tool_evidence: list[dict]
    summary: str
    inference_log: list[StepLog]
    execution_ms: int = Field(ge=0)
    routing_ms: int = Field(ge=0)
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
    label: str = "Execution-cost proxy"
    method: str = "measured inference latency multiplied by stated hourly assumptions"
    exclusions: list[str] = Field(default_factory=lambda: [
        "queue wait",
        "utilization",
        "power and cooling",
        "hardware acquisition and depreciation",
        "platform and operations labor",
    ])


class PolicyRun(BaseModel):
    policy: ExecutionPolicy
    status: Literal["completed", "unavailable", "failed"]
    source_state: Literal["live", "mixed", "unavailable"]
    result: Optional[PipelineResult] = None
    evaluation: Optional[Evaluation] = None
    modeled_cost: Optional[ModeledCost] = None
    error: Optional[str] = None


class QualificationEnvironment(BaseModel):
    id: str
    label: str
    collection_mode: Literal["live_single_environment"] = "live_single_environment"
    vendors: list[Literal["intel", "amd", "nvidia", "other"]] = Field(default_factory=list)


class BakeoffResponse(BaseModel):
    schema_version: Literal["placement-evidence/v1"] = "placement-evidence/v1"
    run_id: str = Field(default_factory=lambda: str(uuid4()))
    comparison_kind: Literal["policy_plus_model"] = "policy_plus_model"
    measurement_scope: Literal["single_environment"] = "single_environment"
    routing_behavior: Literal["warmed_workflow_plan"] = "warmed_workflow_plan"
    quality_scope: Literal["named_case_only"] = "named_case_only"
    environment: QualificationEnvironment = Field(default_factory=lambda: QualificationEnvironment(
        id="unidentified", label="Unidentified qualification environment",
    ))
    vertical: str
    case_id: str
    case_title: str
    collected_at: str
    policies_run: int = Field(ge=1)
    runs: list[PolicyRun]


class ModelOption(BaseModel):
    id: str
    label: str
    hardware: Literal["cpu", "gpu"]
    provider: str
    runtime: str
    vendor: Literal["intel", "amd", "nvidia", "other"] = "other"
    product: str = ""
    identity_source: Literal["observed", "declared"] = "declared"
    support_status: Literal["supported", "technology_preview", "unknown"] = "unknown"
    target_id: str = ""
    available: bool = True


class CaseOption(BaseModel):
    id: str
    title: str


class VerticalOption(BaseModel):
    id: Literal["healthcare", "financial_services", "food_manufacturing"]
    label: str
    description: str
    cases: list[CaseOption]


class CatalogResponse(BaseModel):
    verticals: list[VerticalOption]
    cpu_models: list[ModelOption]
    accelerator_models: list[ModelOption]


class QualificationManifest(BaseModel):
    environment: QualificationEnvironment
    framework_revision: str
    platform: dict[str, str]
    resource_profile: dict[str, dict]
    cpu_model: str
    accelerator_model: str
    case_id: str
    placement_schema_version: Literal["placement-evidence/v1"] = "placement-evidence/v1"


class PolicyQualificationSummary(BaseModel):
    policy: ExecutionPolicy
    attempted_runs: int = Field(ge=1)
    completed_runs: int = Field(ge=0)
    passed_runs: int = Field(ge=0)
    pass_rate_pct: float = Field(ge=0, le=100)
    failure_rate_pct: float = Field(ge=0, le=100)
    live_mcp_rate_pct: float = Field(ge=0, le=100)
    routing_available_rate_pct: float = Field(ge=0, le=100)
    median_execution_ms: Optional[float] = Field(default=None, ge=0)
    p95_execution_ms: Optional[int] = Field(default=None, ge=0)
    median_quality_pct: Optional[float] = Field(default=None, ge=0, le=100)
    minimum_quality_pct: Optional[float] = Field(default=None, ge=0, le=100)
    median_cost_per_1000_tasks_usd: Optional[float] = Field(default=None, ge=0)


class QualificationReport(BaseModel):
    schema_version: Literal["qualification-evidence/v1"] = "qualification-evidence/v1"
    qualification_id: str
    created_at: str
    completed_at: str
    warmup_runs: int = Field(ge=0, le=5)
    measured_runs: int = Field(ge=1, le=30)
    execution_pattern: Literal["sequential_trials_parallel_policies"] = "sequential_trials_parallel_policies"
    manifest: QualificationManifest
    summaries: list[PolicyQualificationSummary]
    trials: list[BakeoffResponse]


class QualificationJob(BaseModel):
    schema_version: Literal["qualification-job/v1"] = "qualification-job/v1"
    job_id: str
    status: Literal["queued", "warming", "measuring", "completed", "failed"]
    created_at: str
    warmup_runs: int = Field(ge=0, le=5)
    measured_runs: int = Field(ge=1, le=30)
    completed_warmup_runs: int = Field(ge=0)
    completed_measured_runs: int = Field(ge=0)
    report: Optional[QualificationReport] = None
    error: Optional[str] = None
