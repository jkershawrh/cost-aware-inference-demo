import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoConfig } from '../demo.config'
import '../live/demoAdapter'
import type { SceneConfig } from '../types'
import { SceneRenderer } from './SceneRenderer'

describe('SceneRenderer', () => {
  const scenes = demoConfig.acts.flatMap((act) => act.scenes)

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
    expect(screen.queryByText('The same case, prompts, tools, and acceptance rule enter all three lanes.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal technical boundary' }))
    expect(await screen.findByText('The same case, prompts, tools, and acceptance rule enter all three lanes.')).toBeInTheDocument()
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
    expect(screen.getByText('Quality decides. Cost breaks the tie.')).toBeInTheDocument()
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
