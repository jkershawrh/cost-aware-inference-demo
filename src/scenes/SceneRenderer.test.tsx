import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoConfig } from '../demo.config'
import { bakeoffFixture, catalogFixture } from '../fixtures/bakeoff'
import '../live/demoAdapter'
import type { SceneConfig } from '../types'
import { EvaluationExplanation } from './BakeoffLive'
import { SceneRenderer } from './SceneRenderer'

describe('SceneRenderer', () => {
  const scenes = demoConfig.acts.flatMap((act) => act.scenes)

  afterEach(() => vi.unstubAllGlobals())

  for (const scene of scenes) {
    it(`renders ${scene.type}: ${scene.id}`, () => {
      const { container } = render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
      expect(container.querySelector('.scene')).toBeInTheDocument()
    })
  }

  it('labels rehearsal data instead of presenting it as live', async () => {
    const scene: SceneConfig = { id: 'fallback', type: 'live-proof', beat: 'live-proof', title: 'Proof', adapterId: 'demo-proof', cta: 'Run live proof', resultFields: [{ key: 'outcome', label: 'Outcome' }] }
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    fireEvent.click(screen.getByRole('button', { name: /run live proof/i }))
    expect(await screen.findByText('rehearsal')).toBeInTheDocument()
  })

  it('renders the intro headline exactly once', () => {
    const scene = scenes.find((item) => item.type === 'intro')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getAllByRole('heading', { name: scene.title })).toHaveLength(1)
  })

  it('runs the three-policy proof and labels fallback evidence', async () => {
    const scene = scenes.find((item) => item.id === 'bakeoff')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    fireEvent.click(screen.getByRole('button', { name: /run the bake-off/i }))
    expect(await screen.findByText('rehearsal')).toBeInTheDocument()
    expect(screen.getByText('CPU only')).toBeInTheDocument()
    expect(screen.getByText('Accelerator only')).toBeInTheDocument()
    expect(screen.getByText('Heterogeneous')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Prompts + responses' }))
    expect(screen.getByText('FINAL RESPONSE')).toBeInTheDocument()
    expect(screen.getAllByText('PROMPT IN').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/RESPONSE OUT/).length).toBeGreaterThan(0)
  })

  it('identifies the live Intel system and the portable Red Hat compute targets', () => {
    const scene = scenes.find((item) => item.id === 'bakeoff')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getByText('Xeon CPU + Gaudi 3')).toBeInTheDocument()
    expect(screen.getAllByAltText('Intel')).toHaveLength(2)
    expect(screen.getByAltText('AMD')).toBeInTheDocument()
    expect(screen.getByAltText('NVIDIA')).toBeInTheDocument()
    expect(screen.getByText(/This run uses Intel hardware/)).toBeInTheDocument()
  })

  it('requests every policy independently and reveals completed lanes progressively', async () => {
    const pending = new Map<string, (response: Response) => void>()
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/catalog')) return Promise.resolve(new Response(JSON.stringify(catalogFixture), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      const policy = JSON.parse(String(init?.body)).policies[0] as string
      return new Promise<Response>((resolve) => pending.set(policy, resolve))
    }))
    const scene = scenes.find((item) => item.id === 'bakeoff')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    fireEvent.click(screen.getByRole('button', { name: /run the bake-off/i }))

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(3))
    for (const call of vi.mocked(fetch).mock.calls.filter((item) => item[1]?.method === 'POST')) {
      const body = JSON.parse(String(call[1]?.body))
      expect(body.policies).toHaveLength(1)
      expect(body.vertical).toBe('healthcare')
      expect(body.cpu_model).toBe('qwen25-3b-cpu')
      expect(body.accelerator_model).toBe('gaudi-llama-31-8b')
    }

    const cpuRun = structuredClone(bakeoffFixture.runs.find((run) => run.policy === 'cpu_only')!)
    cpuRun.result!.execution_ms = 111
    await act(async () => pending.get('cpu_only')!(new Response(JSON.stringify({ ...bakeoffFixture, policies_run: 1, runs: [cpuRun] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    expect(await screen.findByText('111ms')).toBeInTheDocument()
    expect(screen.getAllByText('running')).toHaveLength(2)

    for (const policy of ['gpu_only', 'heterogeneous']) {
      const run = structuredClone(bakeoffFixture.runs.find((item) => item.policy === policy)!)
      await act(async () => pending.get(policy)!(new Response(JSON.stringify({ ...bakeoffFixture, policies_run: 1, runs: [run] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    }
    await waitFor(() => expect(screen.queryByText('running')).not.toBeInTheDocument())
  })

  it('renders the statistic-grid scene', () => {
    const scene: SceneConfig = {
      id: 'coverage-stat-grid',
      type: 'stat-grid',
      beat: 'stakes',
      title: 'The stakes',
      stats: [{ value: '3×', label: 'Faster', tone: 'success' }],
    }
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getByText('3×')).toBeInTheDocument()
    expect(screen.getByText('Faster')).toBeInTheDocument()
  })

  it('renders the custom React scene escape hatch', () => {
    const scene: SceneConfig = {
      id: 'coverage-custom',
      type: 'custom',
      beat: 'live-proof',
      component: () => <div>Custom proof scene</div>,
    }
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getByText('Custom proof scene')).toBeInTheDocument()
  })

  it('guides architecture as audience questions and revealed answers', async () => {
    const scene = scenes.find((item) => item.type === 'guided-architecture')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getByText('How do we make the comparison fair?')).toBeInTheDocument()
    expect(screen.queryByText('The same selected case, models, prompts, tools, and acceptance rule enter all three lanes.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal technical boundary' }))
    expect(await screen.findByText('The same selected case, models, prompts, tools, and acceptance rule enter all three lanes.')).toBeInTheDocument()
    expect(document.querySelector('[data-node="api"]')).toHaveClass('active')
    fireEvent.click(screen.getByRole('button', { name: 'Ask next question →' }))
    expect(await screen.findByText('Who decides where each call runs?')).toBeInTheDocument()
  })

  it('keeps the presenter pitch at seven scenes or fewer', () => {
    expect(scenes.length).toBeLessThanOrEqual(7)
  })

  it('includes the full progressive proof arc before the lab handoff', () => {
    expect(scenes.some((scene) => scene.type === 'guided-architecture')).toBe(true)
    expect(scenes.some((scene) => scene.beat === 'live-proof')).toBe(true)
    expect(scenes.some((scene) => scene.type === 'mechanisms')).toBe(true)
    expect(scenes.at(-1)?.beat).toBe('transformation')
  })

  it('closes on a bounded decision rather than a universal hardware winner', () => {
    const scene = scenes.find((item) => item.beat === 'transformation')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getByText('Pass quality. Lower cost.')).toBeInTheDocument()
  })

  it('resolves the bake-off by separating constants from policy differences', () => {
    const scene = scenes.find((item) => item.id === 'resolution')!
    render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
    expect(screen.getByText('HELD CONSTANT')).toBeInTheDocument()
    expect(screen.getByText('Same MCP evidence')).toBeInTheDocument()
    expect(screen.getByText('Same API contract')).toBeInTheDocument()
    expect(screen.getByText(/lowest-cost policy that passed quality/i)).toBeInTheDocument()
    expect(screen.getByText(/Speed and lowest acceptable cost are different decisions/i)).toBeInTheDocument()
    expect(screen.getAllByText(/^WHY /)).toHaveLength(3)
  })

  it('explains a partial evaluation score instead of showing only the percentage', () => {
    const partialFixture = structuredClone(bakeoffFixture)
    partialFixture.runs[0].evaluation = {
      score_pct: 92.5, threshold_pct: 80, passed: true, scope: 'This checked-in eval case only',
      components: [
        { name: 'classification', earned: 25, possible: 25, detail: 'matched' },
        { name: 'summary fact coverage', earned: 22.5, possible: 30, detail: '3/4 required case facts preserved; missing: Clopidogrel' },
      ],
    }
    render(<EvaluationExplanation evaluation={partialFixture.runs[0].evaluation} />)
    expect(screen.getByText('WHY 92.5%')).toBeInTheDocument()
    expect(screen.getByText(/missing: Clopidogrel/)).toBeInTheDocument()
  })

  const architectureScenes: SceneConfig[] = [
    {
      id: 'coverage-flow', type: 'architecture-flow', beat: 'system-reveal', title: 'Request flow',
      steps: [{ id: 'entry', label: 'Entry', transition: 'route' }, { id: 'model', label: 'Model' }],
    },
    {
      id: 'coverage-layers', type: 'architecture-layers', beat: 'system-reveal', title: 'Layers',
      layers: [{ id: 'platform', label: 'Platform', responsibility: 'Schedules the workload' }],
    },
    {
      id: 'coverage-compare', type: 'architecture-compare', beat: 'reframe', title: 'Structural change',
      before: { label: 'Before', nodes: ['Fixed path'] }, after: { label: 'After', nodes: ['Measured route'] }, insight: 'Measure before routing.',
    },
    {
      id: 'coverage-boundary', type: 'trust-boundary', beat: 'system-reveal', title: 'Trust boundaries',
      zones: [{ id: 'trusted', label: 'Trusted zone', boundary: 'Policy boundary', items: ['Private data'] }],
    },
    {
      id: 'coverage-topology', type: 'deployment-topology', beat: 'system-reveal', title: 'Placement',
      locations: [{ id: 'edge', label: 'Edge', workloads: ['Router'] }],
    },
  ]

  for (const scene of architectureScenes) {
    it(`renders architecture view: ${scene.type}`, () => {
      const { container } = render(<SceneRenderer scene={scene} brand={demoConfig.brand} />)
      expect(container.querySelector('.scene')).toBeInTheDocument()
    })
  }
})
