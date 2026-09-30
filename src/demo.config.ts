import type { DemoConfig } from './types'
import { BakeoffLive } from './scenes/BakeoffLive'
import { BakeoffResolution } from './scenes/BakeoffResolution'

const technicalTopology = {
  boundary: { label: 'Red Hat OpenShift AI', detail: 'one governed application and inference boundary' },
  entry: { id: 'case', kind: 'workload', label: 'Industry case', detail: 'one selected vertical, case, and acceptance rule' },
  primaryPath: [
    { id: 'api', kind: 'service', label: 'Proof API', detail: 'runs three policies concurrently', endpoint: 'POST /api/v1/bakeoff', edgeLabel: 'HTTPS' },
    { id: 'router', kind: 'policy', label: 'Cost-aware router', detail: 'step, confidence, schema, and quality policy', edgeLabel: 'classify step' },
    { id: 'inference', kind: 'runtime', label: 'Red Hat AI Inference', detail: 'one OpenAI-compatible contract across tiers', edgeLabel: 'route call' },
    { id: 'compute', kind: 'compute', label: 'CPU + accelerator tiers', detail: 'Live: Intel Xeon + Gaudi 3 · Portable: supported Intel, AMD, NVIDIA targets', edgeLabel: 'execute' },
  ],
  supportPath: [
    { id: 'mcp', kind: 'tool', label: 'MCP evidence', detail: 'bounded domain-specific tool lookups', edgeLabel: 'ground' },
    { id: 'eval', kind: 'policy', label: 'Eval + cost model', detail: 'case score, latency, and visible hourly assumptions', edgeLabel: 'measure' },
    { id: 'decision', kind: 'authority', label: 'Human decision', detail: 'choose placement; no automated clinical decision', edgeLabel: 'review' },
  ],
}

export const demoConfig: DemoConfig = {
  id: 'cost-aware-inference-demo',
  title: 'Every step on the right compute',
  subtitle: 'A cross-industry, cost-aware inference bake-off on Red Hat AI',
  event: 'Customer briefing',
  audience: 'AI platform, application, and business leaders',
  cta: 'Prove the placement decision with your workload.',
  brand: { primary: { name: 'Red Hat', logo: '/logos/redhat.svg', alt: 'Red Hat' }, attribution: 'Red Hat AI · open compute choice' },
  acts: [
    { id: 'decision', label: '01', title: 'The Decision', scenes: [
      { id: 'intro', type: 'intro', beat: 'ordinary-world', title: 'Nowadays, an agentic task can become dozens of inference calls', subtitle: 'The question has shifted from “CPU or GPU?” to “which step belongs where?”', speakerPrompt: 'Open with the customer decision: protect quality while reducing the cost of a completed task.' },
      { id: 'reframe', type: 'reframe', beat: 'stakes', eyebrow: 'The status quo assumption', title: 'Stop buying one compute answer for every inference step', before: 'Treat the hardest inference step as the ceiling for all of them', after: 'Place each step at its minimum viable compute tier', detail: 'Classification, extraction, tool selection, and summarization do not have the same latency, schema, or reasoning needs.', speakerPrompt: 'Do not claim CPU replaces accelerators. The claim is deliberate placement against a visible acceptance rule.' },
    ] },
    { id: 'architecture', label: '02', title: 'Guided Architecture', scenes: [
      { id: 'guided-architecture', type: 'guided-architecture', beat: 'system-reveal', eyebrow: 'Guided system design', title: 'From workload to result: what each layer decides', body: 'Each layer answers one question. Together they show where each call runs and why.', technicalTopology, layers: [
        { id: 'workload', component: 'Fixed workload', tone: 'primary', question: 'How do we make the comparison fair?', answer: 'The same selected case, models, prompts, tools, and acceptance rule enter all three lanes.', detail: 'Healthcare and Financial Services both follow classify → extract → MCP evidence → summarize, with domain-specific prompts, tools, and evals.', activeNodeIds: ['case', 'api'] },
        { id: 'placement', component: 'Placement policy', tone: 'success', question: 'Who decides where each call runs?', answer: 'A policy routes by step complexity and fails closed when a required tier is unavailable.', detail: 'CPU-only and accelerator-only are controls. Heterogeneous placement is the policy under test.', activeNodeIds: ['router'] },
        { id: 'runtime', component: 'Inference contract', tone: 'primary', question: 'Does the application change when compute changes?', answer: 'No. Red Hat AI Inference exposes one OpenAI-compatible API across supported runtimes.', detail: 'The selected workload stays fixed while the endpoint and model placement change.', activeNodeIds: ['inference'] },
        { id: 'hardware', component: 'Compute options', tone: 'partner', question: 'What hardware are we using? What can be moved?', answer: 'This live run uses Intel Xeon CPU and Intel Gaudi 3. The Red Hat inference contract also supports defined Intel or AMD CPU and NVIDIA or AMD GPU targets.', detail: 'Every result declares model, runtime, provider, route, and source state. Support levels vary; Intel Gaudi 3 is identified as Technology Preview in this Red Hat AI release.', activeNodeIds: ['compute'] },
        { id: 'evidence', component: 'Evidence + evaluation', tone: 'success', question: 'How do we know the cheaper route is still acceptable?', answer: 'The system preserves MCP evidence, scores the named case, and prices measured execution time using visible assumptions.', detail: 'Quality claims apply only to this eval case. Costs are modeled.', activeNodeIds: ['mcp', 'eval', 'decision'] },
      ], speakerPrompt: 'Pause at each question. Tie every box to fairness, placement, portability, or proof.' },
    ] },
    { id: 'proof', label: '03', title: 'Live Bake-off', scenes: [
      { id: 'bakeoff', type: 'custom', beat: 'live-proof', component: BakeoffLive, speakerPrompt: 'State the source badge first. Run all lanes together, compare cost and quality, then open the prompts and outputs.' },
      { id: 'resolution', type: 'custom', beat: 'trials', component: BakeoffResolution, speakerPrompt: 'First name what was held constant. Then distinguish placement, latency, cost, and quality. The fastest lane and lowest-cost passing lane may not be the same.' },
    ] },
    { id: 'mechanism', label: '04', title: 'Why It Works', scenes: [
      { id: 'policy', type: 'mechanisms', beat: 'trials', eyebrow: 'The placement rule', title: 'The routing rule: stay on the least-cost tier that clears the bar', body: 'A step stays on the least-cost tier only while it satisfies the contract.', mechanisms: [
        { id: 'structured', label: 'Structured first', claim: 'Use CPU for short, constrained work.', detail: 'Classification and extraction remain on CPU when schema and confidence checks pass.', tone: 'success' },
        { id: 'escalate', label: 'Escalate deliberately', claim: 'Use acceleration for the hard step.', detail: 'Longer synthesis or any failed confidence/schema check can move to an accelerator.', tone: 'primary' },
        { id: 'portable', label: 'Keep choice open', claim: 'The contract outlives the hardware choice.', detail: 'Red Hat provides the platform contract; Intel, AMD, and NVIDIA participate according to workload fit and supported lifecycle.', tone: 'partner' },
      ], citation: { label: 'Red Hat AI Inference supported configurations', url: 'https://docs.redhat.com/en/documentation/red_hat_ai/3/html/supported_product_and_hardware_configurations/rhaiis-supported-ai-accelerators_supported-configurations' }, speakerPrompt: 'Be explicit: hardware support levels vary. The UI reports what actually served each call.' },
    ] },
    { id: 'close', label: '05', title: 'The Payoff', scenes: [
      { id: 'payoff', type: 'punchline', beat: 'transformation', eyebrow: 'The decision', title: 'Right workload. Right compute.', line1: 'One API. Multiple tiers.', line2: 'Pass quality. Lower cost.', cta: 'Next: test yours.', speakerPrompt: 'Close on the customer method, not a universal winner. Their workload determines placement.' },
    ] },
  ],
  journeyHandoffs: [
    { depth: 'guided', title: 'Guided workload workshop', duration: '25–40 minutes', question: 'Which steps can move without lowering the acceptance rate?', technology: 'Red Hat OpenShift AI · Red Hat AI Inference · CPU and accelerator tiers', instruction: 'Replace the case set, set cost assumptions, run the eval, and review every routed call.' },
  ],
}
