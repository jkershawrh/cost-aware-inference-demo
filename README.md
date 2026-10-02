# Cost-Aware Inference Demo

A standalone Triforce-style presentation and live cross-industry bake-off for Red Hat AI. Select Healthcare or Financial Services plus the available CPU and accelerator models, then run the same four-step workload under CPU-only, accelerator-only, and heterogeneous placement policies. The selector changes the real endpoint, prompts, MCP tools, and case-specific evaluation—not just the label. The UI exposes execution and route-planning latency, an execution-cost proxy, evaluation, routing decisions, prompts, responses, model identity, and hardware evidence.

The three policies start concurrently and return progressively, so a completed lane is visible without waiting for the slowest one. Each vertical's semantic-routing plan is warmed and cached when the proof service starts; an uncached planning cost is reported separately from model execution rather than hidden inside task latency.

This project does not replace or modify Triforce. Triforce is the presentation and evidence-pattern reference.

## Run locally

```bash
npm ci
npm run check
uvicorn app:app --app-dir services/proof-api --host 0.0.0.0 --port 8090
npm run dev
```

Copy `.env.example` to `.env` and export only the endpoints and credentials required for the live tiers. Never commit the resulting file.

## Evidence rules

- `LIVE` means the proof API returned the response during this session.
- `MIXED` means at least one supporting source, such as MCP, used its labeled rehearsal fallback.
- `REHEARSAL` means the browser used the checked-in fixture because the proof API was unavailable.
- CPU cost is zero only when the presenter explicitly selects **CPUs already provisioned**.
- Accelerator and dedicated-CPU rates are visible assumptions, not vendor quotes.
- The displayed cost is an execution-cost proxy: measured inference latency multiplied by the visible hourly assumptions. It excludes utilization, queueing, power, cooling, acquisition, depreciation, and operations.
- Quality is a deterministic score for the named checked-in case, not a general model-quality claim.
- Required inference tiers fail closed and appear as `unavailable`; they do not silently borrow another lane.
- A run compares a placement policy plus its selected model, not hardware in isolation.
- Heterogeneous routing uses a workflow plan warmed at service startup, not a new context-aware placement decision for every request.

## Hardware roles

Red Hat OpenShift AI and Red Hat AI Inference provide the deployment, serving, lifecycle, and common API contract. The current live reference deployment uses Intel Xeon CPU and Intel Gaudi 3. The framework is designed to be redeployed and qualified later in AMD and NVIDIA environments; it does not require all three environments to be reachable at once. Each response records the vendor, product, support status, target identifier, and whether hardware identity was observed or declared.

Cross-provider comparison is retrospective: export the versioned `placement-evidence/v1` response from each qualified environment, then compare saved records by timestamp and environment. Set `QUALIFICATION_ENVIRONMENT_ID` and `QUALIFICATION_ENVIRONMENT_LABEL` for every deployment. Never label saved AMD, Intel, and NVIDIA runs as one simultaneous live test.

For repeatable qualification, use **Qualification & export** after selecting the workload and models. The background workflow accepts 0–5 warm-ups and 1–30 measured trials; certification runs should use 10–30 measured trials. It exports `qualification-evidence/v1` with the environment manifest, raw trials, median and p95 execution latency, quality pass consistency, failure rate, live-MCP rate, route-evidence availability, and median execution-cost proxy. One qualification job may run at a time to avoid distorting the shared hardware. Jobs are held in memory, so download the report before restarting the proof API.

## OpenShift

See `deploy/openshift/README.md`. The public profile targets a dedicated `cost-aware-inference-demo` namespace and keeps cluster identity, external routes, and credentials outside the repository.
