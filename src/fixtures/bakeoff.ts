import type { BakeoffResponse } from '../scenes/BakeoffLive'

export const bakeoffFixture: BakeoffResponse = {
  sourceState: 'rehearsal',
  case_id: 'discharge-stemi-001',
  case_title: 'Cardiac discharge summary with medication interaction context',
  collected_at: '2026-09-30T12:00:00Z',
  policies_run: 3,
  runs: [
    {
      policy: 'cpu_only', status: 'completed', source_state: 'mixed',
      modeled_cost: { cost_per_task_usd: 0, cost_per_1000_tasks_usd: 0 },
      evaluation: { score_pct: 92, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only' },
      result: {
        classification: 'discharge_summary', total_ms: 9200,
        entities: [{ text: 'Metformin', type: 'medication' }, { text: 'Lisinopril', type: 'medication' }, { text: 'Aspirin', type: 'medication' }, { text: 'Clopidogrel', type: 'medication' }, { text: 'STEMI', type: 'condition' }],
        drug_interactions: [{ drug_a: 'Aspirin', drug_b: 'Clopidogrel', severity: 'moderate' }],
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
      evaluation: { score_pct: 96, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only' },
      result: {
        classification: 'discharge_summary', total_ms: 2800,
        entities: [{ text: 'Metformin', type: 'medication' }, { text: 'Lisinopril', type: 'medication' }, { text: 'Aspirin', type: 'medication' }, { text: 'Clopidogrel', type: 'medication' }, { text: 'STEMI', type: 'condition' }, { text: 'PCI', type: 'procedure' }],
        drug_interactions: [{ drug_a: 'Aspirin', drug_b: 'Clopidogrel', severity: 'moderate' }],
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
      evaluation: { score_pct: 96, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only' },
      result: {
        classification: 'discharge_summary', total_ms: 4300,
        entities: [{ text: 'Metformin', type: 'medication' }, { text: 'Lisinopril', type: 'medication' }, { text: 'Aspirin', type: 'medication' }, { text: 'Clopidogrel', type: 'medication' }, { text: 'STEMI', type: 'condition' }, { text: 'PCI', type: 'procedure' }],
        drug_interactions: [{ drug_a: 'Aspirin', drug_b: 'Clopidogrel', severity: 'moderate' }],
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
