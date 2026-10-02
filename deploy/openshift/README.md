# OpenShift test deployment

The deployment owns the `cost-aware-inference-demo` namespace and does not modify Triforce or existing model-serving namespaces.

1. Apply `resources.yaml`.
2. Start the `presentation` binary build from the repository root.
3. Start the `proof-api` binary build from `services/proof-api`.
4. Keep cluster-specific routes and credentials outside Git. Copy `external-endpoints.env.example` to the ignored `external-endpoints.env`, populate it, and create `proof-api-secrets` as shown below when external models are required.
5. Verify the Intel Gaudi Base Operator exposes `habana.ai/gaudi` capacity before applying the checked-in Gaudi serving resources.
6. Verify `mcp-gateway` lists the healthcare and financial-services evidence tools.
7. Wait for the checked-in CPU and Gaudi `InferenceService` resources to become ready, then verify every model through `/v1/models` and one completion before using it in the bake-off.
8. Before qualification, set the immutable source revision and deployed platform versions in `QUALIFICATION_FRAMEWORK_REVISION` and `QUALIFICATION_PLATFORM_JSON`. Confirm that `QUALIFICATION_RESOURCE_PROFILE_JSON` matches the applied requests and limits.

The checked-in public profile uses namespace-local Qwen 2.5 3B on CPU plus Llama 3.1 8B and Granite 3.1 8B LAB on Intel Gaudi 3. Additional CPU or accelerator endpoints are deployment inputs and must not be committed. The MCP gateway image is digest-pinned and supplies live healthcare medication evidence plus financial risk, AML, and sanctions evidence. The model catalog checks each configured endpoint before enabling it in the selector. The writable `habana-logs` volume is required by the restricted OpenShift runtime user. A missing required tier is returned as `unavailable`; it is never replaced with rehearsal data inside the API. The browser may show its clearly labeled checked-in rehearsal fixture if the proof API itself cannot be reached.

```bash
cp deploy/openshift/external-endpoints.env.example deploy/openshift/external-endpoints.env
# Edit the ignored file with the target environment's routes and keys.
oc -n cost-aware-inference-demo create secret generic proof-api-secrets \
  --from-env-file=deploy/openshift/external-endpoints.env \
  --dry-run=client -o yaml | oc apply -f -
oc -n cost-aware-inference-demo rollout restart deployment/proof-api
```

`CPU_MODEL_ENDPOINTS_JSON` and `ACCELERATOR_MODEL_ENDPOINTS_JSON` in the Secret replace the public defaults, so include every endpoint that should appear in the selector—including namespace-local models.

## Qualification evidence

The presenter comparison remains a single run. Qualification is a separate background workflow exposed under **Qualification & export** and through the API:

```bash
curl -X POST "$DEMO_URL/proof/api/v1/qualification" \
  -H 'Content-Type: application/json' \
  -d @qualification-request.json

curl "$DEMO_URL/proof/api/v1/qualification/$JOB_ID"
```

Use one to five warm-up runs and 10–30 measured runs for certification. Trials execute sequentially to avoid inter-trial load distortion; CPU-only, accelerator-only, and heterogeneous policies execute concurrently within each trial to preserve the demonstrated workload pattern. The completed `qualification-evidence/v1` report includes raw placement evidence plus median latency, p95 latency, quality consistency, failure rate, and live-MCP rate. Save that report outside the cluster before restarting the proof API because job state is intentionally in-memory.
