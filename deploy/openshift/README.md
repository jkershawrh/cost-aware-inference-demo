# OpenShift test deployment

The deployment owns the `cost-aware-inference-demo` namespace and does not modify Triforce or existing model-serving namespaces.

1. Apply `resources.yaml`.
2. Start the `presentation` binary build from the repository root.
3. Start the `proof-api` binary build from `services/proof-api`.
4. Populate `proof-api-secrets` only when an endpoint requires keys.
5. Verify the Intel Gaudi Base Operator exposes `habana.ai/gaudi` capacity before applying the checked-in Gaudi serving resources.
6. Verify `mcp-gateway` lists the healthcare and financial-services evidence tools.
7. Wait for the checked-in CPU and Gaudi `InferenceService` resources to become ready, then verify every model through `/v1/models` and one completion before using it in the bake-off.

The checked-in cluster profile reuses the Triforce semantic-router and MCP gateway contracts. The MCP gateway image is digest-pinned and supplies live healthcare medication evidence plus financial risk, AML, and sanctions evidence. The model catalog is generated from configured Red Hat AI Inference endpoints and checks each endpoint before enabling it in the selector. The current profile includes Qwen 2.5 3B, Llama 3.1 8B, and Gemma 4 26B A4B on CPU plus Llama 3.1 8B and Granite 3.1 8B LAB on Intel Gaudi 3. The writable `habana-logs` volume is required by the restricted OpenShift runtime user. A missing required tier is returned as `unavailable`; it is never replaced with rehearsal data inside the API. The browser may show its clearly labeled checked-in rehearsal fixture if the proof API itself cannot be reached.
