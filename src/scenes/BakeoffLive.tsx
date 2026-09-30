import { useMemo, useState } from 'react'
import { bakeoffFixture } from '../fixtures/bakeoff'
import { runProof } from '../live/proof'
import type { ProofState } from '../types'
import { SceneFrame } from './SceneFrame'

export interface BakeoffStep {
  node: string
  model: string
  accelerator: 'cpu' | 'gpu' | 'tool'
  hardware_provider: string
  latency_ms: number
  route: string
  prompt: string
  output: string
  source_state: 'live' | 'rehearsal'
}

export interface BakeoffRun {
  policy: 'cpu_only' | 'gpu_only' | 'heterogeneous'
  status: 'completed' | 'unavailable' | 'failed'
  source_state: 'live' | 'mixed' | 'unavailable'
  error?: string
  modeled_cost?: { cost_per_task_usd: number; cost_per_1000_tasks_usd: number }
  evaluation?: { score_pct: number; threshold_pct: number; passed: boolean; scope: string }
  result?: {
    classification: string
    entities: Array<{ text: string; type: string }>
    drug_interactions: Array<Record<string, unknown>>
    summary: string
    inference_log: BakeoffStep[]
    total_ms: number
  }
}

export interface BakeoffResponse extends Record<string, unknown> {
  sourceState?: 'live' | 'mixed' | 'rehearsal' | 'offline'
  case_id: string
  case_title: string
  collected_at: string
  policies_run: number
  runs: BakeoffRun[]
}

const labels = { cpu_only: 'CPU only', gpu_only: 'Accelerator only', heterogeneous: 'Heterogeneous' }

export function BakeoffLive() {
  const [cpuExisting, setCpuExisting] = useState(true)
  const [cpuHourly, setCpuHourly] = useState(4)
  const [gpuHourly, setGpuHourly] = useState(36)
  const [proof, setProof] = useState<ProofState<BakeoffResponse>>({ status: 'idle' })
  const [selected, setSelected] = useState<BakeoffRun['policy']>('heterogeneous')
  const [view, setView] = useState<'results' | 'responses'>('results')

  const run = async () => {
    setProof({ status: 'loading' })
    const adapter = {
      id: 'healthcare-bakeoff', timeoutMs: 180_000,
      rehearsal: { data: bakeoffFixture, collectedAt: bakeoffFixture.collected_at },
      async load(signal: AbortSignal) {
        const response = await fetch('/proof/api/v1/bakeoff', {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            case_id: 'discharge-stemi-001',
            quality_threshold_pct: 80,
            cost_assumptions: { cpu_already_provisioned: cpuExisting, cpu_hourly_usd: cpuHourly, gpu_hourly_usd: gpuHourly },
          }),
        })
        if (!response.ok) throw new Error(`Proof API returned HTTP ${response.status}`)
        const data = await response.json() as BakeoffResponse
        data.sourceState = data.runs.some((item) => item.status === 'completed' && item.source_state === 'mixed') ? 'mixed' : 'live'
        return data
      },
    }
    setProof(await runProof(adapter))
  }

  const completed = proof.data?.runs.filter((item) => item.status === 'completed') ?? []
  const winner = useMemo(() => completed.length < 2 ? undefined : completed.filter((item) => item.evaluation?.passed).sort((a, b) => (a.modeled_cost?.cost_per_1000_tasks_usd ?? Infinity) - (b.modeled_cost?.cost_per_1000_tasks_usd ?? Infinity) || (a.result?.total_ms ?? Infinity) - (b.result?.total_ms ?? Infinity))[0], [completed])
  const selectedRun = proof.data?.runs.find((item) => item.policy === selected)

  return <SceneFrame scene={{ id: 'bakeoff-live', beat: 'live-proof', eyebrow: 'Live healthcare workload', title: 'One task. Three compute policies. One acceptance rule.', body: 'Run all three lanes in parallel, then inspect the actual prompts, responses, routes, latency, modeled cost, and case-specific quality.' }}>
    <div className="bakeoff-shell" onClick={(event) => event.stopPropagation()}>
      <div className="bakeoff-toolbar">
        <label><input type="checkbox" checked={cpuExisting} onChange={(event) => setCpuExisting(event.target.checked)} /> CPUs already provisioned</label>
        <label>Dedicated CPU $/hr <input type="number" min="0" step="0.5" value={cpuHourly} onChange={(event) => setCpuHourly(Number(event.target.value))} /></label>
        <label>Accelerator $/hr <input type="number" min="0" step="1" value={gpuHourly} onChange={(event) => setGpuHourly(Number(event.target.value))} /></label>
        <button className="button button-primary" onClick={run} disabled={proof.status === 'loading'}>{proof.status === 'loading' ? 'Running three policies…' : proof.status === 'ready' ? 'Run again' : 'Run the bake-off →'}</button>
      </div>

      <div className="hardware-portability" aria-label="Compute hardware context">
        <div className="hardware-current">
          <span>LIVE ON THIS CLUSTER</span>
          <img src="/logos/intel.png" alt="Intel" />
          <strong>Xeon CPU + Gaudi 3</strong>
        </div>
        <div className="hardware-targets">
          <span>SUPPORTED TARGETS</span>
          <div className="vendor-badges" aria-label="Intel, AMD, and NVIDIA compute options">
            <span className="vendor-badge"><img src="/logos/intel.png" alt="Intel" /></span>
            <span className="vendor-badge"><img src="/logos/amd.svg" alt="AMD" /></span>
            <span className="vendor-badge vendor-badge-nvidia"><img src="/logos/nvidia.svg" alt="NVIDIA" /></span>
          </div>
        </div>
        <small>This run uses Intel hardware. The same Red Hat AI Inference API contract can target supported Intel or AMD CPUs, NVIDIA or AMD GPUs, and Intel Gaudi accelerators.</small>
      </div>

      {proof.status === 'idle' && <div className="bakeoff-idle"><div className="bakeoff-flow"><span>CLASSIFY</span><b>→</b><span>EXTRACT</span><b>→</b><span>MCP CHECK</span><b>→</b><span>SUMMARIZE</span></div><strong>The same checked-in discharge summary enters all three lanes at once.</strong><small>Cost inputs are assumptions. Quality is scored only against this named eval case.</small></div>}
      {proof.status === 'loading' && <div className="bakeoff-idle"><strong>CPU-only, accelerator-only, and heterogeneous are running in parallel.</strong><small>Every lane must return its own model, hardware identity, prompt, response, and source state.</small></div>}

      {proof.status === 'ready' && proof.data && <>
        <div className="bakeoff-view-tabs"><button className={view === 'results' ? 'active' : ''} onClick={() => setView('results')}>Measured comparison</button><button className={view === 'responses' ? 'active' : ''} onClick={() => setView('responses')}>Prompts + responses</button><span className={`source-badge source-${proof.source}`}>{proof.source}</span></div>
        {proof.error && <div className="fallback-note">Live endpoint unavailable: showing checked-in rehearsal evidence.</div>}
        {proof.source === 'mixed' && <div className="fallback-note">Live inference · rehearsal MCP evidence. Inspect each step for its source.</div>}
        {view === 'results' ? <div className="bakeoff-grid">
          {proof.data.runs.map((item) => {
            const cpuCalls = item.result?.inference_log.filter((step) => step.accelerator === 'cpu').length ?? 0
            const gpuCalls = item.result?.inference_log.filter((step) => step.accelerator === 'gpu').length ?? 0
            return <button className={`bakeoff-lane ${selected === item.policy ? 'selected' : ''} ${winner?.policy === item.policy ? 'winner' : ''}`} key={item.policy} onClick={() => setSelected(item.policy)}>
              <header><span>{labels[item.policy]}</span>{winner?.policy === item.policy && <b>LOWEST COST PASS</b>}</header>
              {item.status !== 'completed' ? <div className="lane-unavailable"><strong>{item.status}</strong><small>{item.error}</small></div> : <>
                <div className="lane-metrics"><div><small>Task latency</small><strong>{item.result?.total_ms}ms</strong></div><div><small>Cost / 1K</small><strong>${item.modeled_cost?.cost_per_1000_tasks_usd.toFixed(2)}</strong></div><div><small>Eval score</small><strong className={item.evaluation?.passed ? 'pass' : 'fail'}>{item.evaluation?.score_pct}%</strong></div></div>
                <div className="lane-route"><span>{cpuCalls} CPU calls</span><span>{gpuCalls} accelerator calls</span></div>
                <div className="lane-steps">{item.result?.inference_log.filter((step) => step.accelerator !== 'tool').map((step) => <div key={step.node}><span className={step.accelerator}>{step.accelerator}</span><b>{step.node.replace('_', ' ')}</b><small>{step.model} · {step.latency_ms}ms</small></div>)}</div>
                <small className="identity">{item.result?.inference_log.find((step) => step.accelerator !== 'tool')?.hardware_provider}</small>
              </>}
            </button>
          })}
        </div> : <div className="bakeoff-responses">
          <nav>{proof.data.runs.map((item) => <button className={selected === item.policy ? 'active' : ''} onClick={() => setSelected(item.policy)} key={item.policy}>{labels[item.policy]}</button>)}</nav>
          {selectedRun?.result ? <><div className="response-summary"><span>FINAL RESPONSE</span><p>{selectedRun.result.summary}</p></div><div className="response-steps">{selectedRun.result.inference_log.map((step) => <div key={step.node}><header><b>{step.node.replace('_', ' ')}</b><span>{step.accelerator.toUpperCase()} · {step.model} · {step.latency_ms}ms</span></header><small>PROMPT IN</small><p>{step.prompt}</p><small>RESPONSE OUT · {step.source_state}</small><p>{step.output}</p></div>)}</div></> : <div className="lane-unavailable">{selectedRun?.error}</div>}
        </div>}
      </>}
    </div>
  </SceneFrame>
}
