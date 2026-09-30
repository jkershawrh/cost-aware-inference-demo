# OpenShift test deployment

The deployment owns the `cost-aware-inference-demo` namespace and does not modify Triforce or existing model-serving namespaces.

1. Apply `resources.yaml`.
2. Start the `presentation` binary build from the repository root.
3. Start the `proof-api` binary build from `services/proof-api`.
4. Populate `proof-api-secrets` only when an endpoint requires keys.
5. Set `GPU_API_BASE` and `SEMANTIC_ROUTER_URL` only after those live services pass readiness checks.

The checked-in cluster profile reuses the Triforce semantic-router image and its embedding-based classification pattern. It leaves the accelerator endpoint empty until allocatable hardware and a ready serving endpoint are verified. A missing required tier is returned as `unavailable`; it is never replaced with rehearsal data inside the API. The browser may show its clearly labeled checked-in rehearsal fixture if the proof API itself cannot be reached.
