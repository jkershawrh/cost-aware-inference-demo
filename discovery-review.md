# Discovery review

Source: `repository://triforce`
Destination: `repository://cost-aware-inference-demo`
Blueprint status: **draft**

## Automated findings

- 127 candidate source artifacts recorded.
- 7 runtime-object candidates detected.
- AI signal: `agentic`; necessity: `unknown`.

These are discovery candidates, not approved presentation claims.

## Required review

- Confirm the primary user, workload, recognized problem, audience decision, and desired outcome.
- Verify every runtime object against contracts, manifests, implementation, or a live deployment.
- Trace at least one typed end-to-end architecture flow with protocols and evidence IDs.
- Define the source system's operational pattern in domain language, including one changed condition and the close.
- Inventory live evidence and distinguish live, rehearsal, simulated, and future-state behavior.
- Resolve deterministic policy, fail-closed behavior, action authority, and final decision ownership.
- If AI participates, verify its task, exact inputs and outputs, model/hardware identity sources, evidence access, validation, and fallback.
- Record discrepancies rather than silently reconciling documentation and implementation.

## Promotion gate

Do not change `status: draft` until material findings are sourced. Then run:

```bash
npm run validate:blueprint -- ./demo-blueprint.yaml
```

Validation requires a domain-specific operational step, a typed architecture flow, evidence, and resolved AI authority when AI is used.
