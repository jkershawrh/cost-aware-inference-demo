import { useEffect, useMemo, useRef, useState } from 'react'
import { bakeoffFixture, bakeoffFixtures, catalogFixture } from '../fixtures/bakeoff'
import { runProof, setCachedProof } from '../live/proof'
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
  status: 'running' | 'completed' | 'unavailable' | 'failed'
  source_state: 'live' | 'mixed' | 'unavailable'
  error?: string
  modeled_cost?: { cost_per_task_usd: number; cost_per_1000_tasks_usd: number }
  evaluation?: {
    score_pct: number
    threshold_pct: number
    passed: boolean
    scope: string
    components?: Array<{ name: string; earned: number; possible: number; detail: string }>
  }
  result?: {
    classification: string
    entities: Array<{ text: string; type: string }>
    tool_evidence: Array<Record<string, unknown>>
    summary: string
    inference_log: BakeoffStep[]
    execution_ms: number
    routing_ms: number
    total_ms: number
  }
}

export interface BakeoffResponse extends Record<string, unknown> {
  sourceState?: 'live' | 'mixed' | 'rehearsal' | 'offline'
  vertical: string
  case_id: string
  case_title: string
  collected_at: string
  policies_run: number
  runs: BakeoffRun[]
}

export interface BakeoffCatalog {
  verticals: Array<{ id: 'healthcare' | 'financial_services'; label: string; description: string; cases: Array<{ id: string; title: string }> }>
  cpu_models: Array<{ id: string; label: string; provider: string; runtime: string; available: boolean }>
  accelerator_models: Array<{ id: string; label: string; provider: string; runtime: string; available: boolean }>
}

const labels = { cpu_only: 'CPU only', gpu_only: 'Accelerator only', heterogeneous: 'Heterogeneous' }
const policies: BakeoffRun['policy'][] = ['cpu_only', 'gpu_only', 'heterogeneous']

export function EvaluationExplanation({ evaluation }: { evaluation: NonNullable<BakeoffRun['evaluation']> }) {
  const deductions = evaluation.components?.filter((component) => component.earned < component.possible) ?? []
  return <div className="eval-explanation">
    <span>{deductions.length ? `WHY ${evaluation.score_pct}%` : 'EVALUATION'}</span>
    {deductions.length ? deductions.map((component) => <div key={component.name}>
      <b>{component.name}</b>
      <small>{component.earned}/{component.possible} · {component.detail}</small>
    </div>) : <small>{evaluation.components?.length ? 'All weighted case checks passed.' : 'Component breakdown unavailable for this fallback result.'}</small>}
  </div>
}

export function BakeoffLive() {
  const [catalog, setCatalog] = useState<BakeoffCatalog>(catalogFixture)
  const [vertical, setVertical] = useState<'healthcare' | 'financial_services'>('healthcare')
  const [cpuModel, setCpuModel] = useState(catalogFixture.cpu_models[0].id)
  const [acceleratorModel, setAcceleratorModel] = useState(catalogFixture.accelerator_models[0].id)
  const [cpuExisting, setCpuExisting] = useState(true)
  const [cpuHourly, setCpuHourly] = useState(4)
  const [gpuHourly, setGpuHourly] = useState(36)
  const [proof, setProof] = useState<ProofState<BakeoffResponse>>({ status: 'idle' })
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<BakeoffRun['policy']>('heterogeneous')
  const [view, setView] = useState<'results' | 'responses'>('results')
  const activeRun = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/proof/api/v1/catalog', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
      .then((data: BakeoffCatalog) => {
        setCatalog(data)
        const firstCpu = data.cpu_models.find((item) => item.available)
        const firstAccelerator = data.accelerator_models.find((item) => item.available)
        if (firstCpu) setCpuModel(firstCpu.id)
        if (firstAccelerator) setAcceleratorModel(firstAccelerator.id)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => () => {
    activeRun.current?.abort()
    activeRun.current = null
  }, [])

  const run = async () => {
    activeRun.current?.abort()
    const controller = new AbortController()
    activeRun.current = controller
    const collectedAt = new Date().toISOString()
    const selectedVertical = catalog.verticals.find((item) => item.id === vertical) ?? catalog.verticals[0]
    const selectedCase = selectedVertical.cases[0]
    const fixture = bakeoffFixtures[vertical] ?? bakeoffFixture
    const initial: BakeoffResponse = {
      vertical,
      case_id: selectedCase.id,
      case_title: selectedCase.title,
      collected_at: collectedAt,
      policies_run: policies.length,
      runs: policies.map((policy) => ({ policy, status: 'running', source_state: 'unavailable' })),
    }
    const laneSources = new Map<BakeoffRun['policy'], ProofState<BakeoffResponse>['source']>()
    setRunning(true)
    setView('results')
    const initialState: ProofState<BakeoffResponse> = { status: 'ready', data: initial, collectedAt }
    setProof(initialState)
    setCachedProof('latest-bakeoff', initialState)

    await Promise.allSettled(policies.map(async (policy) => {
      const fixtureRun = fixture.runs.find((item) => item.policy === policy)!
      const rehearsal = { ...fixture, policies_run: 1, runs: [fixtureRun] }
      const state = await runProof<BakeoffResponse>({
        id: `${vertical}-bakeoff-${policy}`, timeoutMs: 180_000,
        rehearsal: { data: rehearsal, collectedAt: fixture.collected_at },
        async load(signal: AbortSignal) {
          const response = await fetch('/proof/api/v1/bakeoff', {
            method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vertical, case_id: selectedCase.id, cpu_model: cpuModel, accelerator_model: acceleratorModel,
              policies: [policy], quality_threshold_pct: 80,
              cost_assumptions: { cpu_already_provisioned: cpuExisting, cpu_hourly_usd: cpuHourly, gpu_hourly_usd: gpuHourly },
            }),
          })
          if (!response.ok) throw new Error(`Proof API returned HTTP ${response.status}`)
          const data = await response.json() as BakeoffResponse
          data.sourceState = data.runs.some((item) => item.status === 'completed' && item.source_state === 'mixed') ? 'mixed' : 'live'
          return data
        },
      }, controller.signal)
      if (controller.signal.aborted || !state.data) return
      const lane = state.data.runs[0]
      laneSources.set(policy, state.source)
      setProof((current) => {
        if (!current.data) return current
        const sources = [...laneSources.values()]
        const source: ProofState<BakeoffResponse>['source'] = sources.every((value) => value === 'rehearsal' || value === 'offline')
          ? 'rehearsal'
          : sources.some((value) => value !== 'live') || lane.source_state === 'mixed' ? 'mixed' : 'live'
        const errors = state.error ? [state.error] : []
        const next: ProofState<BakeoffResponse> = {
          ...current,
          source,
          error: [current.error, ...errors].filter(Boolean).join(' · ') || undefined,
          data: { ...current.data, collected_at: state.data!.collected_at, runs: current.data.runs.map((item) => item.policy === policy ? lane : item) },
        }
        setCachedProof('latest-bakeoff', next)
        return next
      })
    }))
    if (activeRun.current === controller) {
      activeRun.current = null
      setRunning(false)
    }
  }

  const completed = proof.data?.runs.filter((item) => item.status === 'completed') ?? []
  const winner = useMemo(() => completed.length < 2 ? undefined : completed.filter((item) => item.evaluation?.passed).sort((a, b) => (a.modeled_cost?.cost_per_1000_tasks_usd ?? Infinity) - (b.modeled_cost?.cost_per_1000_tasks_usd ?? Infinity) || (a.result?.total_ms ?? Infinity) - (b.result?.total_ms ?? Infinity))[0], [completed])
  const selectedRun = proof.data?.runs.find((item) => item.policy === selected)

  const verticalInfo = catalog.verticals.find((item) => item.id === vertical) ?? catalog.verticals[0]

  return <SceneFrame scene={{ id: 'bakeoff-live', beat: 'live-proof', eyebrow: `Live ${verticalInfo.label} workload`, title: 'One task. Three compute policies. One acceptance rule.', body: 'Choose the workload and real model endpoints, run all three lanes in parallel, then inspect prompts, responses, routes, latency, modeled cost, and case-specific quality.' }}>
    <div className="bakeoff-shell" onClick={(event) => event.stopPropagation()}>
      <div className="bakeoff-toolbar">
        <label>Industry <select value={vertical} onChange={(event) => { setVertical(event.target.value as typeof vertical); setProof({ status: 'idle' }) }}>{catalog.verticals.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label>CPU model <select value={cpuModel} onChange={(event) => { setCpuModel(event.target.value); setProof({ status: 'idle' }) }}>{catalog.cpu_models.map((item) => <option value={item.id} key={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · starting'}</option>)}</select></label>
        <label>Accelerator model <select value={acceleratorModel} onChange={(event) => { setAcceleratorModel(event.target.value); setProof({ status: 'idle' }) }}>{catalog.accelerator_models.map((item) => <option value={item.id} key={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · starting'}</option>)}</select></label>
        <label><input type="checkbox" checked={cpuExisting} onChange={(event) => setCpuExisting(event.target.checked)} /> CPUs already provisioned</label>
        <label>Dedicated CPU $/hr <input type="number" min="0" step="0.5" value={cpuHourly} onChange={(event) => setCpuHourly(Number(event.target.value))} /></label>
        <label>Accelerator $/hr <input type="number" min="0" step="1" value={gpuHourly} onChange={(event) => setGpuHourly(Number(event.target.value))} /></label>
        <button className="button button-primary" onClick={run} disabled={running}>{running ? 'Running three policies…' : proof.status === 'ready' ? 'Run again' : 'Run the bake-off →'}</button>
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

      {proof.status === 'idle' && <div className="bakeoff-idle"><div className="bakeoff-flow"><span>CLASSIFY</span><b>→</b><span>EXTRACT</span><b>→</b><span>MCP EVIDENCE</span><b>→</b><span>SUMMARIZE</span></div><strong>{verticalInfo.description}</strong><small>The same checked-in case and selected models enter all three lanes. Cost inputs are assumptions; quality is scoped to this case.</small></div>}
      {proof.status === 'ready' && proof.data && <>
        <div className="bakeoff-view-tabs"><button className={view === 'results' ? 'active' : ''} onClick={() => setView('results')}>Measured comparison</button><button disabled={running} className={view === 'responses' ? 'active' : ''} onClick={() => setView('responses')}>Prompts + responses</button>{running ? <span className="source-badge source-mixed">{completed.length} / 3 complete</span> : <span className={`source-badge source-${proof.source}`}>{proof.source}</span>}</div>
        {proof.error && <div className="fallback-note">Live endpoint unavailable: showing checked-in rehearsal evidence.</div>}
        {proof.source === 'mixed' && <div className="fallback-note">Live inference · rehearsal MCP evidence. Inspect each step for its source.</div>}
        {view === 'results' ? <div className="bakeoff-grid">
          {proof.data.runs.map((item) => {
            const cpuCalls = item.result?.inference_log.filter((step) => step.accelerator === 'cpu').length ?? 0
            const gpuCalls = item.result?.inference_log.filter((step) => step.accelerator === 'gpu').length ?? 0
            return <button className={`bakeoff-lane ${selected === item.policy ? 'selected' : ''} ${winner?.policy === item.policy ? 'winner' : ''}`} key={item.policy} onClick={() => setSelected(item.policy)}>
              <header><span>{labels[item.policy]}</span>{winner?.policy === item.policy && <b>LOWEST COST PASS</b>}</header>
              {item.status !== 'completed' ? <div className={`lane-unavailable lane-${item.status}`}><strong>{item.status}</strong><small>{item.status === 'running' ? 'This lane is returning independently.' : item.error}</small></div> : <>
                <div className="lane-metrics"><div><small>Execution</small><strong>{item.result?.execution_ms}ms</strong>{Boolean(item.result?.routing_ms) && <small>+ {item.result?.routing_ms}ms route plan</small>}</div><div><small>Cost / 1K</small><strong>${item.modeled_cost?.cost_per_1000_tasks_usd.toFixed(2)}</strong></div><div><small>Eval score</small><strong className={item.evaluation?.passed ? 'pass' : 'fail'}>{item.evaluation?.score_pct}%</strong></div></div>
                {item.evaluation && <EvaluationExplanation evaluation={item.evaluation} />}
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
