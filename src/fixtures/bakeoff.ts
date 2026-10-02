import type { BakeoffCatalog, BakeoffResponse } from '../scenes/BakeoffLive'

export const catalogFixture: BakeoffCatalog = {
  verticals: [
    { id: 'healthcare', label: 'Healthcare', description: 'Clinical document triage with medication evidence and a physician handoff.', cases: [{ id: 'discharge-stemi-001', title: 'Cardiac discharge summary with medication interaction context' }] },
    { id: 'financial_services', label: 'Financial Services', description: 'Transaction alert triage with customer risk, regulatory, and sanctions evidence.', cases: [{ id: 'wire-alert-001', title: 'High-value international wire with a new beneficiary' }] },
  ],
  cpu_models: [
    { id: 'qwen25-3b-cpu', label: 'Qwen 2.5 3B Instruct · Xeon', provider: 'Intel Xeon CPU', runtime: 'Red Hat AI Inference vLLM CPU runtime', vendor: 'intel', product: 'Xeon', identity_source: 'declared', support_status: 'supported', target_id: 'fixture-intel-cpu', available: true },
    { id: 'redhataillama-31-8b-instruct', label: 'Llama 3.1 8B Instruct · Xeon', provider: 'Intel Xeon CPU', runtime: 'Red Hat AI Inference vLLM CPU runtime', vendor: 'intel', product: 'Xeon', identity_source: 'declared', support_status: 'supported', target_id: 'fixture-intel-cpu', available: true },
    { id: 'redhataigemma-4-26b-a4b-it-sml', label: 'Gemma 4 26B A4B · Xeon', provider: 'Intel Xeon CPU', runtime: 'Red Hat AI Inference vLLM CPU runtime', vendor: 'intel', product: 'Xeon', identity_source: 'declared', support_status: 'supported', target_id: 'fixture-intel-cpu', available: true },
  ],
  accelerator_models: [
    { id: 'gaudi-llama-31-8b', label: 'Llama 3.1 8B · Gaudi 3', provider: 'Intel Gaudi 3', runtime: 'Red Hat AI Inference vLLM Gaudi runtime', vendor: 'intel', product: 'Gaudi 3', identity_source: 'observed', support_status: 'technology_preview', target_id: 'fixture-intel-gaudi', available: true },
    { id: 'gaudi-granite-31-8b', label: 'Granite 3.1 8B LAB · Gaudi 3', provider: 'Intel Gaudi 3', runtime: 'Red Hat AI Inference vLLM Gaudi runtime', vendor: 'intel', product: 'Gaudi 3', identity_source: 'observed', support_status: 'technology_preview', target_id: 'fixture-intel-gaudi', available: true },
  ],
}

export const bakeoffFixture: BakeoffResponse = {
  sourceState: 'rehearsal',
  vertical: 'healthcare',
  case_id: 'discharge-stemi-001',
  case_title: 'Cardiac discharge summary with medication interaction context',
  collected_at: '2026-09-30T12:00:00Z',
  policies_run: 3,
  runs: [
    {
      policy: 'cpu_only', status: 'completed', source_state: 'mixed',
      modeled_cost: { cost_per_task_usd: 0, cost_per_1000_tasks_usd: 0 },
      evaluation: { score_pct: 86.67, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only', components: [
        { name: 'classification', earned: 25, possible: 25, detail: 'expected discharge_summary; received discharge_summary' },
        { name: 'entity recall', earned: 16.67, possible: 30, detail: '5/9 expected entities found; missing: Type 2 Diabetes, PCI, hypertension, CKD' },
        { name: 'tool evidence', earned: 15, possible: 15, detail: '2/2 required evidence terms found' },
        { name: 'summary fact coverage', earned: 30, possible: 30, detail: '4/4 required case facts preserved' },
      ] },
      result: {
        classification: 'discharge_summary', execution_ms: 9200, routing_ms: 0, total_ms: 9200,
        entities: [{ text: 'Metformin', type: 'medication' }, { text: 'Lisinopril', type: 'medication' }, { text: 'Aspirin', type: 'medication' }, { text: 'Clopidogrel', type: 'medication' }, { text: 'STEMI', type: 'condition' }],
        tool_evidence: [{ tool: 'drug_interaction_check', result: { interactions: [{ drug_a: 'Aspirin', drug_b: 'Clopidogrel', severity: 'moderate' }] } }],
        summary: 'The patient was treated for STEMI with PCI to the RCA and discharged on dual antiplatelet therapy with Aspirin and Clopidogrel. Monitor bleeding risk and renal function.',
        inference_log: [
          { node: 'classify', model: 'qwen25-3b-cpu', accelerator: 'cpu', hardware_provider: 'Intel Xeon or AMD EPYC — declared', latency_ms: 780, route: 'forced_cpu', prompt: 'Classify this clinical document into exactly one category…', output: 'discharge_summary', source_state: 'live' },
          { node: 'extract_entities', model: 'granite-2b-cpu', accelerator: 'cpu', hardware_provider: 'Intel Xeon or AMD EPYC — declared', latency_ms: 5600, route: 'forced_cpu', prompt: 'Extract all medications, conditions, and procedures…', output: '[{"text":"Metformin","type":"medication"}, …]', source_state: 'live' },
          { node: 'summarize', model: 'qwen25-3b-cpu', accelerator: 'cpu', hardware_provider: 'Intel Xeon or AMD EPYC — declared', latency_ms: 2820, route: 'forced_cpu', prompt: 'Draft a concise physician handoff summary…', output: 'The patient was treated for STEMI with PCI…', source_state: 'live' },
        ],
      },
    },
    {
      policy: 'gpu_only', status: 'completed', source_state: 'mixed',
      modeled_cost: { cost_per_task_usd: 0.028, cost_per_1000_tasks_usd: 28 },
      evaluation: { score_pct: 90, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only', components: [
        { name: 'classification', earned: 25, possible: 25, detail: 'expected discharge_summary; received discharge_summary' },
        { name: 'entity recall', earned: 20, possible: 30, detail: '6/9 expected entities found; missing: Type 2 Diabetes, hypertension, CKD' },
        { name: 'tool evidence', earned: 15, possible: 15, detail: '2/2 required evidence terms found' },
        { name: 'summary fact coverage', earned: 30, possible: 30, detail: '4/4 required case facts preserved' },
      ] },
      result: {
        classification: 'discharge_summary', execution_ms: 2800, routing_ms: 0, total_ms: 2800,
        entities: [{ text: 'Metformin', type: 'medication' }, { text: 'Lisinopril', type: 'medication' }, { text: 'Aspirin', type: 'medication' }, { text: 'Clopidogrel', type: 'medication' }, { text: 'STEMI', type: 'condition' }, { text: 'PCI', type: 'procedure' }],
        tool_evidence: [{ tool: 'drug_interaction_check', result: { interactions: [{ drug_a: 'Aspirin', drug_b: 'Clopidogrel', severity: 'moderate' }] } }],
        summary: 'Following STEMI, the patient underwent RCA PCI and is discharged on Aspirin and Clopidogrel. Continue diabetes and hypertension therapy while monitoring bleeding and CKD-related renal risk.',
        inference_log: [
          { node: 'classify', model: 'granite-8b', accelerator: 'gpu', hardware_provider: 'Intel Gaudi 3 — declared · Technology Preview', latency_ms: 420, route: 'forced_gpu', prompt: 'Classify this clinical document into exactly one category…', output: 'discharge_summary', source_state: 'live' },
          { node: 'extract_entities', model: 'granite-8b', accelerator: 'gpu', hardware_provider: 'Intel Gaudi 3 — declared · Technology Preview', latency_ms: 1120, route: 'forced_gpu', prompt: 'Extract all medications, conditions, and procedures…', output: '[{"text":"Metformin","type":"medication"}, …]', source_state: 'live' },
          { node: 'summarize', model: 'granite-8b', accelerator: 'gpu', hardware_provider: 'Intel Gaudi 3 — declared · Technology Preview', latency_ms: 1260, route: 'forced_gpu', prompt: 'Draft a concise physician handoff summary…', output: 'Following STEMI, the patient underwent RCA PCI…', source_state: 'live' },
        ],
      },
    },
    {
      policy: 'heterogeneous', status: 'completed', source_state: 'mixed',
      modeled_cost: { cost_per_task_usd: 0.012, cost_per_1000_tasks_usd: 12 },
      evaluation: { score_pct: 90, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only', components: [
        { name: 'classification', earned: 25, possible: 25, detail: 'expected discharge_summary; received discharge_summary' },
        { name: 'entity recall', earned: 20, possible: 30, detail: '6/9 expected entities found; missing: Type 2 Diabetes, hypertension, CKD' },
        { name: 'tool evidence', earned: 15, possible: 15, detail: '2/2 required evidence terms found' },
        { name: 'summary fact coverage', earned: 30, possible: 30, detail: '4/4 required case facts preserved' },
      ] },
      result: {
        classification: 'discharge_summary', execution_ms: 4300, routing_ms: 0, total_ms: 4300,
        entities: [{ text: 'Metformin', type: 'medication' }, { text: 'Lisinopril', type: 'medication' }, { text: 'Aspirin', type: 'medication' }, { text: 'Clopidogrel', type: 'medication' }, { text: 'STEMI', type: 'condition' }, { text: 'PCI', type: 'procedure' }],
        tool_evidence: [{ tool: 'drug_interaction_check', result: { interactions: [{ drug_a: 'Aspirin', drug_b: 'Clopidogrel', severity: 'moderate' }] } }],
        summary: 'Following STEMI, the patient underwent RCA PCI and is discharged on Aspirin and Clopidogrel. Continue chronic therapy and monitor bleeding and renal function.',
        inference_log: [
          { node: 'classify', model: 'qwen25-3b-cpu', accelerator: 'cpu', hardware_provider: 'Intel Xeon or AMD EPYC — declared', latency_ms: 760, route: 'simple', prompt: 'Classify this clinical document into exactly one category…', output: 'discharge_summary', source_state: 'live' },
          { node: 'extract_entities', model: 'granite-2b-cpu', accelerator: 'cpu', hardware_provider: 'Intel Xeon or AMD EPYC — declared', latency_ms: 2340, route: 'medium', prompt: 'Extract all medications, conditions, and procedures…', output: '[{"text":"Metformin","type":"medication"}, …]', source_state: 'live' },
          { node: 'summarize', model: 'granite-8b', accelerator: 'gpu', hardware_provider: 'Intel Gaudi 3 — declared · Technology Preview', latency_ms: 1200, route: 'complex', prompt: 'Draft a concise physician handoff summary…', output: 'Following STEMI, the patient underwent RCA PCI…', source_state: 'live' },
        ],
      },
    },
  ],
}

const financialFixture: BakeoffResponse = {
  ...bakeoffFixture,
  vertical: 'financial_services',
  case_id: 'wire-alert-001',
  case_title: 'High-value international wire with a new beneficiary',
  runs: bakeoffFixture.runs.map((run) => ({
    ...run,
    evaluation: { score_pct: 100, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only', components: [
      { name: 'classification', earned: 25, possible: 25, detail: 'expected high_value_wire_alert; received high_value_wire_alert' },
      { name: 'entity recall', earned: 30, possible: 30, detail: '5/5 expected entities found' },
      { name: 'tool evidence', earned: 15, possible: 15, detail: '3/3 required evidence terms found' },
      { name: 'summary fact coverage', earned: 30, possible: 30, detail: '4/4 required case facts preserved' },
    ] },
    result: run.result && {
      ...run.result,
      classification: 'high_value_wire_alert',
      entities: [
        { text: 'C-1842', type: 'customer_id' }, { text: 'TX-94721', type: 'transaction_id' },
        { text: '$48,750', type: 'amount' }, { text: 'Northstar Trading', type: 'beneficiary' }, { text: 'Estonia', type: 'country' },
      ],
      tool_evidence: [
        { tool: 'risk_profile_lookup', result: { risk_level: 'low' } },
        { tool: 'regulatory_rule_check', result: { regulation: 'aml', status: 'pass' } },
        { tool: 'sanction_list_search', result: { screened: true, matches: [] } },
      ],
      summary: 'Review the $48,750 wire to Northstar Trading in Estonia. The customer profile is low risk and screening returned no match, but the new international beneficiary and amount require human review.',
    },
  })),
}

export const bakeoffFixtures: Record<string, BakeoffResponse> = {
  healthcare: bakeoffFixture,
  financial_services: financialFixture,
}
