import { useEffect, useRef, useState } from 'react'
import { getAdapter } from '../live/adapters'
import { runProof } from '../live/proof'
import type { LiveJourneyScene, ProofState } from '../types'
import { SceneFrame } from './SceneFrame'
import { TechnicalTopology } from './TechnicalTopology'

export function LiveJourney({ scene }: { scene: LiveJourneyScene }) {
  const [stepIndex, setStepIndex] = useState(-1)
  const [state, setState] = useState<ProofState>({ status: 'idle' })
  const [showTopology, setShowTopology] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const step = stepIndex >= 0 ? scene.steps[stepIndex] : undefined
  const nextStep = stepIndex + 1 < scene.steps.length ? scene.steps[stepIndex + 1] : undefined
  const complete = stepIndex === scene.steps.length - 1 && state.status === 'ready'

  useEffect(() => () => controller.current?.abort(), [])

  async function runStep(index: number) {
    controller.current?.abort()
    controller.current = new AbortController()
    setStepIndex(index)
    setState({ status: 'loading' })
    const next = scene.steps[index]
    const adapter = getAdapter(next.adapterId)
    if (!adapter) {
      setState({ status: 'error', error: `Adapter not registered: ${next.adapterId}` })
      return
    }
    setState(await runProof(adapter, controller.current.signal))
  }

  return <SceneFrame scene={scene}><div className="live-workspace" data-testid="live-workspace">
    <nav className="live-workspace-steps" aria-label="Live proof progress">
      {scene.steps.map((item, index) => <button key={item.id} disabled={index > stepIndex} className={index === stepIndex ? 'active' : index < stepIndex ? 'complete' : ''} onClick={() => index < stepIndex && void runStep(index)}><span>{index < stepIndex ? '✓' : index + 1}</span>{item.title}</button>)}
    </nav>
    <div className="live-workspace-main">
      <div className="journey-status">
        <small>{step ? `STEP ${stepIndex + 1} OF ${scene.steps.length}` : scene.eyebrow ?? 'GUIDED PROOF'}</small>
        <strong>{step?.title ?? scene.title}</strong>
        <span>{step?.detail ?? scene.body}</span>
        {state.source && <span className={`source-badge source-${state.source}`}>{state.source}</span>}
      </div>
      {!step && scene.prompt && <div className="live-workspace-intake"><span>{scene.prompt.label}</span><strong>{scene.prompt.title}</strong><small>{scene.prompt.detail}</small></div>}
      {!scene.technicalTopology && step && <div className="live-architecture" aria-label="Live architecture journey">
      {scene.nodes.map((node, index) => <div className="live-node-wrap" key={node.id}>
        <div className={`live-node ${node.tone ? `tone-${node.tone}` : ''} ${step && index <= step.activeNode ? 'done' : ''} ${step?.activeNode === index ? 'active' : ''}`}>
          <strong>{node.label}</strong>{node.detail && <span>{node.detail}</span>}
        </div>
        {index < scene.nodes.length - 1 && <div className={`live-edge ${step && index < step.activeNode ? 'done' : ''}`}>→</div>}
      </div>)}
      </div>}
    {state.status === 'ready' && state.data && step && <div className="journey-results">
      {step.resultFields.map((field) => <div className="journey-result" key={field.key}><span>{field.label}</span><strong>{String(state.data?.[field.key] ?? '—')}{field.suffix}</strong></div>)}
    </div>}
    {state.error && <p className="fallback-note">{state.error}{state.status === 'ready' ? ' Showing clearly labeled fallback evidence.' : ''}</p>}
      <div className="journey-controls">
      {scene.technicalTopology && <button className="button button-secondary" onClick={() => setShowTopology((visible) => !visible)}>{showTopology ? 'Hide' : 'Inspect'} technical topology</button>}
      {stepIndex < 0 && <button className="button button-primary" onClick={() => runStep(0)}>{scene.cta}</button>}
      {stepIndex >= 0 && !complete && state.status !== 'loading' && nextStep && <button className="button button-primary" onClick={() => runStep(stepIndex + 1)}>{nextStep.title} →</button>}
      {state.status === 'loading' && <button className="button button-primary" disabled>Running…</button>}
      {state.status === 'error' && <button className="button button-secondary" onClick={() => runStep(stepIndex)}>Retry</button>}
      {complete && <button className="button button-secondary" onClick={() => { setStepIndex(-1); setState({ status: 'idle' }); setShowTopology(false) }}>Replay</button>}
      {complete && scene.workspace && <a className="button button-primary" href={scene.workspace.href}>{scene.workspace.label} →</a>}
      </div>
    </div>
    {scene.context && <aside className="live-workspace-context"><span>{scene.context.label}</span><strong>{scene.context.title}</strong><p>{scene.context.body}</p>{scene.context.footnote && <small>{scene.context.footnote}</small>}</aside>}
  </div>
  {showTopology && scene.technicalTopology && <div className="live-topology-drawer"><TechnicalTopology topology={scene.technicalTopology} activeIds={step?.activeNodeIds ?? []} /></div>}
  </SceneFrame>
}
