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
  hardware?: {
    tier: 'cpu' | 'accelerator' | 'tool'
    vendor: 'intel' | 'amd' | 'nvidia' | 'other' | 'not_applicable'
    product: string
    identity_source: 'observed' | 'declared' | 'not_applicable'
    support_status: 'supported' | 'technology_preview' | 'unknown' | 'not_applicable'
    target_id: string
  }
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
  modeled_cost?: { cost_per_task_usd: number; cost_per_1000_tasks_usd: number; label?: string; method?: string; exclusions?: string[] }
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
  schema_version?: 'placement-evidence/v1'
  run_id?: string
  comparison_kind?: 'policy_plus_model'
  measurement_scope?: 'single_environment'
  routing_behavior?: 'warmed_workflow_plan'
  quality_scope?: 'named_case_only'
  environment?: {
    id: string
    label: string
    collection_mode: 'live_single_environment'
    vendors: Array<'intel' | 'amd' | 'nvidia' | 'other'>
  }
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
  cpu_models: Array<{ id: string; label: string; provider: string; runtime: string; vendor?: 'intel' | 'amd' | 'nvidia' | 'other'; product?: string; identity_source?: 'observed' | 'declared'; support_status?: 'supported' | 'technology_preview' | 'unknown'; target_id?: string; available: boolean }>
  accelerator_models: Array<{ id: string; label: string; provider: string; runtime: string; vendor?: 'intel' | 'amd' | 'nvidia' | 'other'; product?: string; identity_source?: 'observed' | 'declared'; support_status?: 'supported' | 'technology_preview' | 'unknown'; target_id?: string; available: boolean }>
}

interface QualificationSummary {
  policy: BakeoffRun['policy']
  attempted_runs: number
  completed_runs: number
  passed_runs: number
  pass_rate_pct: number
  failure_rate_pct: number
  live_mcp_rate_pct: number
  routing_available_rate_pct: number
  median_execution_ms?: number
  p95_execution_ms?: number
  median_quality_pct?: number
  minimum_quality_pct?: number
  median_cost_per_1000_tasks_usd?: number
}

interface QualificationReport {
  schema_version: 'qualification-evidence/v1'
  qualification_id: string
  created_at: string
  completed_at: string
  warmup_runs: number
  measured_runs: number
  execution_pattern: 'sequential_trials_parallel_policies'
  manifest: {
    environment: NonNullable<BakeoffResponse['environment']>
    framework_revision: string
    platform: Record<string, string>
    resource_profile: Record<string, Record<string, unknown>>
    cpu_model: string
    accelerator_model: string
    case_id: string
    placement_schema_version: 'placement-evidence/v1'
  }
  summaries: QualificationSummary[]
  trials: BakeoffResponse[]
}

interface QualificationJob {
  job_id: string
  status: 'queued' | 'warming' | 'measuring' | 'completed' | 'failed'
  warmup_runs: number
  measured_runs: number
  completed_warmup_runs: number
  completed_measured_runs: number
  report?: QualificationReport
  error?: string
}

const labels = { cpu_only: 'CPU only', gpu_only: 'Accelerator only', heterogeneous: 'Heterogeneous' }
const policies: BakeoffRun['policy'][] = ['cpu_only', 'gpu_only', 'heterogeneous']

function downloadEvidence(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

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
  const [laneEvidence, setLaneEvidence] = useState<Partial<Record<BakeoffRun['policy'], BakeoffResponse>>>({})
  const [qualificationRuns, setQualificationRuns] = useState(10)
  const [qualificationWarmups, setQualificationWarmups] = useState(1)
  const [qualification, setQualification] = useState<QualificationJob | null>(null)
  const [qualificationError, setQualificationError] = useState<string>()
  const activeRun = useRef<AbortController | null>(null)
  const activeQualification = useRef<AbortController | null>(null)

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
    activeQualification.current?.abort()
    activeRun.current = null
    activeQualification.current = null
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
    setLaneEvidence({})
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
              cost_assumptions: { cpu_already_provisioned: cpuExisting, cpu_hourly_usd: cpuHourly, accelerator_hourly_usd: gpuHourly },
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
      if (state.data.schema_version === 'placement-evidence/v1') {
        setLaneEvidence((current) => ({ ...current, [policy]: state.data! }))
      }
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
          data: {
            ...current.data,
            environment: state.data!.environment ?? current.data.environment,
            collected_at: state.data!.collected_at,
            runs: current.data.runs.map((item) => item.policy === policy ? lane : item),
          },
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

  const startQualification = async () => {
    activeQualification.current?.abort()
    const controller = new AbortController()
    activeQualification.current = controller
    const selectedVertical = catalog.verticals.find((item) => item.id === vertical) ?? catalog.verticals[0]
    const selectedCase = selectedVertical.cases[0]
    setQualification(null)
    setQualificationError(undefined)
    try {
      const started = await fetch('/proof/api/v1/qualification', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical, case_id: selectedCase.id, cpu_model: cpuModel, accelerator_model: acceleratorModel,
          policies, quality_threshold_pct: 80, warmup_runs: qualificationWarmups, measured_runs: qualificationRuns,
          cost_assumptions: { cpu_already_provisioned: cpuExisting, cpu_hourly_usd: cpuHourly, accelerator_hourly_usd: gpuHourly },
        }),
      })
      if (!started.ok) throw new Error(`Qualification API returned HTTP ${started.status}`)
      let job = await started.json() as QualificationJob
      setQualification(job)
      while (!controller.signal.aborted && !['completed', 'failed'].includes(job.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        const response = await fetch(`/proof/api/v1/qualification/${job.job_id}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Qualification status returned HTTP ${response.status}`)
        job = await response.json() as QualificationJob
        setQualification(job)
      }
      if (job.status === 'failed') throw new Error(job.error || 'Qualification failed')
    } catch (error) {
      if (!controller.signal.aborted) setQualificationError(error instanceof Error ? error.message : 'Qualification failed')
    } finally {
      if (activeQualification.current === controller) activeQualification.current = null
    }
  }

  const completed = proof.data?.runs.filter((item) => item.status === 'completed') ?? []
  const winner = useMemo(() => completed.length < 2 ? undefined : completed.filter((item) => item.evaluation?.passed).sort((a, b) => (a.modeled_cost?.cost_per_1000_tasks_usd ?? Infinity) - (b.modeled_cost?.cost_per_1000_tasks_usd ?? Infinity) || (a.result?.total_ms ?? Infinity) - (b.result?.total_ms ?? Infinity))[0], [completed])
  const selectedRun = proof.data?.runs.find((item) => item.policy === selected)

  const verticalInfo = catalog.verticals.find((item) => item.id === vertical) ?? catalog.verticals[0]
  const selectedCpu = catalog.cpu_models.find((item) => item.id === cpuModel) ?? catalog.cpu_models[0]
  const selectedAccelerator = catalog.accelerator_models.find((item) => item.id === acceleratorModel) ?? catalog.accelerator_models[0]
  const liveVendors = [...new Set([selectedCpu?.vendor, selectedAccelerator?.vendor].filter((vendor): vendor is 'intel' | 'amd' | 'nvidia' => Boolean(vendor && vendor !== 'other')))]
  const vendorLogo = (vendor: 'intel' | 'amd' | 'nvidia') => vendor === 'intel' ? '/logos/intel.png' : `/logos/${vendor}.svg`

  return <SceneFrame scene={{ id: 'bakeoff-live', beat: 'live-proof', eyebrow: `Live ${verticalInfo.label} workload`, title: 'One task. Three compute policies. One acceptance rule.', body: 'Choose the workload and real model endpoints, run all three lanes in parallel, then inspect prompts, responses, routes, latency, the execution-cost proxy, and case-specific quality.' }}>
    <div className="bakeoff-shell" onClick={(event) => event.stopPropagation()}>
      <div className="bakeoff-toolbar">
        <fieldset className="toolbar-group toolbar-workload">
          <legend>1 · Workload</legend>
          <label><span>Industry</span><select value={vertical} onChange={(event) => { setVertical(event.target.value as typeof vertical); setProof({ status: 'idle' }) }}>{catalog.verticals.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        </fieldset>
        <fieldset className="toolbar-group toolbar-models">
          <legend>2 · Models</legend>
          <label><span>CPU</span><select value={cpuModel} onChange={(event) => { setCpuModel(event.target.value); setProof({ status: 'idle' }) }}>{catalog.cpu_models.map((item) => <option value={item.id} key={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · starting'}</option>)}</select></label>
          <label><span>Accelerator</span><select value={acceleratorModel} onChange={(event) => { setAcceleratorModel(event.target.value); setProof({ status: 'idle' }) }}>{catalog.accelerator_models.map((item) => <option value={item.id} key={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · starting'}</option>)}</select></label>
        </fieldset>
        <fieldset className="toolbar-group toolbar-cost">
          <legend>3 · Cost assumptions</legend>
          <label className="toolbar-check"><input type="checkbox" checked={cpuExisting} onChange={(event) => setCpuExisting(event.target.checked)} /><span>Existing CPU capacity</span></label>
          <div className="toolbar-cost-fields">
            <label className={cpuExisting ? 'inactive' : ''}><span>CPU $/hr</span><input aria-label="Dedicated CPU dollars per hour" type="number" min="0" step="0.5" value={cpuHourly} disabled={cpuExisting} onChange={(event) => setCpuHourly(Number(event.target.value))} /></label>
            <label><span>Accelerator $/hr</span><input type="number" min="0" step="1" value={gpuHourly} onChange={(event) => setGpuHourly(Number(event.target.value))} /></label>
          </div>
        </fieldset>
        <div className="toolbar-action">
          <span>4 · Compare</span>
          <button className="button button-primary" onClick={run} disabled={running}>{running ? 'Running three policies…' : proof.status === 'ready' ? 'Run again' : 'Run three policies →'}</button>
          <small>Runs concurrently</small>
        </div>
      </div>

      <div className="hardware-portability" aria-label="Compute hardware context">
        <div className="hardware-current">
          <span>LIVE ON THIS CLUSTER</span>
          {liveVendors.map((vendor) => <img key={vendor} src={vendorLogo(vendor)} alt={`${vendor.toUpperCase()} live`} />)}
          <strong>{selectedCpu?.product || selectedCpu?.provider} + {selectedAccelerator?.product || selectedAccelerator?.provider}</strong>
        </div>
        <div className="hardware-targets">
          <span>QUALIFICATION ROADMAP</span>
          <div className="vendor-badges" aria-label="Intel, AMD, and NVIDIA compute options">
            <span className="vendor-badge"><img src="/logos/intel.png" alt="Intel" /></span>
            <span className="vendor-badge"><img src="/logos/amd.svg" alt="AMD" /></span>
            <span className="vendor-badge vendor-badge-nvidia"><img src="/logos/nvidia.svg" alt="NVIDIA" /></span>
          </div>
        </div>
          <small>This live run uses the selected environment only. The framework can be redeployed and qualified later on Intel, AMD, or NVIDIA environments using the same Red Hat AI Inference API contract; saved runs are labeled by environment and timestamp.</small>
      </div>

      {proof.status === 'idle' && <div className="bakeoff-idle"><div className="bakeoff-flow"><span>CLASSIFY</span><b>→</b><span>EXTRACT</span><b>→</b><span>MCP EVIDENCE</span><b>→</b><span>SUMMARIZE</span></div><strong>{verticalInfo.description}</strong><small>The same checked-in case and selected models enter all three lanes. Cost inputs are assumptions; quality is scoped to this case.</small></div>}
      {proof.status === 'ready' && proof.data && <>
        <div className="bakeoff-view-tabs"><button className={view === 'results' ? 'active' : ''} onClick={() => setView('results')}>Measured comparison</button><button disabled={running} className={view === 'responses' ? 'active' : ''} onClick={() => setView('responses')}>Prompts + responses</button>{laneEvidence[selected] && <button onClick={() => downloadEvidence(laneEvidence[selected], `${vertical}-${selected}-placement-evidence.json`)}>Download selected evidence</button>}{running ? <span className="source-badge source-mixed">{completed.length} / 3 complete</span> : <span className={`source-badge source-${proof.source}`}>{proof.source}</span>}</div>
        {proof.error && <div className="fallback-note">Live endpoint unavailable: showing checked-in rehearsal evidence.</div>}
        {proof.source === 'mixed' && <div className="fallback-note">Live inference · rehearsal MCP evidence. Inspect each step for its source.</div>}
        {view === 'results' ? <div className="bakeoff-grid">
          {proof.data.runs.map((item) => {
            const cpuCalls = item.result?.inference_log.filter((step) => step.accelerator === 'cpu').length ?? 0
            const gpuCalls = item.result?.inference_log.filter((step) => step.accelerator === 'gpu').length ?? 0
            return <button className={`bakeoff-lane ${selected === item.policy ? 'selected' : ''} ${winner?.policy === item.policy ? 'winner' : ''}`} key={item.policy} onClick={() => setSelected(item.policy)}>
              <header><span>{labels[item.policy]}</span>{winner?.policy === item.policy && <b>LOWEST PROXY PASS</b>}</header>
              {item.status !== 'completed' ? <div className={`lane-unavailable lane-${item.status}`}><strong>{item.status}</strong><small>{item.status === 'running' ? 'This lane is returning independently.' : item.error}</small></div> : <>
                <div className="lane-metrics"><div><small>Execution</small><strong>{item.result?.execution_ms}ms</strong>{Boolean(item.result?.routing_ms) && <small>+ {item.result?.routing_ms}ms route plan</small>}</div><div><small>Proxy / 1K</small><strong>${item.modeled_cost?.cost_per_1000_tasks_usd.toFixed(2)}</strong></div><div><small>Eval score</small><strong className={item.evaluation?.passed ? 'pass' : 'fail'}>{item.evaluation?.score_pct}%</strong></div></div>
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

      <details className="qualification-tools">
        <summary>Qualification & export</summary>
        <div className="qualification-controls">
          <div><strong>Repeat the selected workload</strong><small>Trials run sequentially; the three policies run concurrently inside each trial.</small></div>
          <label><span>Warm-ups</span><input aria-label="Qualification warm-up runs" type="number" min="0" max="5" value={qualificationWarmups} onChange={(event) => setQualificationWarmups(Number(event.target.value))} /></label>
          <label><span>Measured</span><input aria-label="Qualification measured runs" type="number" min="1" max="30" value={qualificationRuns} onChange={(event) => setQualificationRuns(Number(event.target.value))} /></label>
          <button className="button button-secondary" disabled={Boolean(qualification && !['completed', 'failed'].includes(qualification.status))} onClick={startQualification}>Start qualification</button>
        </div>
        {qualification && <div className="qualification-status">
          <span>{qualification.status.toUpperCase()}</span>
          <strong>{qualification.status === 'warming' ? `${qualification.completed_warmup_runs} / ${qualification.warmup_runs} warm-ups` : `${qualification.completed_measured_runs} / ${qualification.measured_runs} measured`}</strong>
          {qualification.report && <>
            <div className="qualification-summaries">{qualification.report.summaries.map((summary) => <div key={summary.policy}><b>{labels[summary.policy]}</b><small>median {summary.median_execution_ms}ms · p95 {summary.p95_execution_ms}ms · {summary.pass_rate_pct}% pass · {summary.live_mcp_rate_pct}% MCP · {summary.routing_available_rate_pct}% route evidence</small></div>)}</div>
            <button className="button button-primary" onClick={() => downloadEvidence(qualification.report, `${vertical}-${qualification.report!.qualification_id}-qualification-evidence.json`)}>Download qualification report</button>
          </>}
        </div>}
        {qualificationError && <div className="fallback-note">{qualificationError}</div>}
      </details>
    </div>
  </SceneFrame>
}
