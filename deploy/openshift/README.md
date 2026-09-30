# OpenShift test deployment

The deployment owns the `cost-aware-inference-demo` namespace and does not modify Triforce or existing model-serving namespaces.

1. Apply `resources.yaml`.
2. Start the `presentation` binary build from the repository root.
3. Start the `proof-api` binary build from `services/proof-api`.
4. Populate `proof-api-secrets` only when an endpoint requires keys.
5. Verify the Intel Gaudi Base Operator exposes `habana.ai/gaudi` capacity before applying the checked-in Gaudi serving resources.
6. Verify `mcp-gateway` lists `drug_interaction_check` and returns structured interaction evidence.
7. Wait for `gaudi-llama-31-8b` to become ready, then run the three-policy bake-off.

The checked-in cluster profile reuses the Triforce semantic-router and MCP gateway contracts. The MCP gateway image is digest-pinned and supplies the live JSON-RPC `drug_interaction_check` step. Its live accelerator tier uses the OpenShift AI-provided, digest-pinned Red Hat AI Inference Gaudi runtime and an OCI modelcar. The writable `habana-logs` volume is required by the restricted OpenShift runtime user. A missing required tier is returned as `unavailable`; it is never replaced with rehearsal data inside the API. The browser may show its clearly labeled checked-in rehearsal fixture if the proof API itself cannot be reached.
