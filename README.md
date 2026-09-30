# Cost-Aware Inference Demo

A standalone Triforce-style presentation and live cross-industry bake-off for Red Hat AI. Select Healthcare or Financial Services plus the available CPU and accelerator models, then run the same four-step workload under CPU-only, accelerator-only, and heterogeneous placement policies. The selector changes the real endpoint, prompts, MCP tools, and case-specific evaluation—not just the label. The UI exposes execution and route-planning latency, modeled cost, evaluation, routing decisions, prompts, responses, model identity, and declared hardware identity.

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
- Quality is a deterministic score for the named checked-in case, not a general model-quality claim.
- Required inference tiers fail closed and appear as `unavailable`; they do not silently borrow another lane.

## Hardware roles

Red Hat OpenShift AI and Red Hat AI Inference provide the deployment, serving, lifecycle, and common API contract. The live reference deployment uses Intel Xeon CPU and Intel Gaudi 3. Intel Xeon and AMD EPYC are supported CPU options; NVIDIA GPUs, AMD Instinct GPUs, and Intel Gaudi accelerators are options where supported by the installed Red Hat AI release. The response records the provider and whether that identity was observed or declared.

## OpenShift

See `deploy/openshift/README.md`. The test profile targets the dedicated `cost-aware-inference-demo` namespace on `rhgaudi3s2` and keeps all credentials outside the repository.
