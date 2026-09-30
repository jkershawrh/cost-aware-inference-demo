import { bakeoffFixture } from '../fixtures/bakeoff'
import { getCachedProof } from '../live/proof'
import { EvaluationExplanation, type BakeoffResponse, type BakeoffRun } from './BakeoffLive'
import { SceneFrame } from './SceneFrame'

const labels: Record<BakeoffRun['policy'], string> = {
  cpu_only: 'CPU only',
  gpu_only: 'Accelerator only',
  heterogeneous: 'Heterogeneous',
}

function placement(run: BakeoffRun) {
  const calls = run.result?.inference_log.filter((step) => step.accelerator !== 'tool') ?? []
  const cpu = calls.filter((step) => step.accelerator === 'cpu').length
  const accelerator = calls.filter((step) => step.accelerator === 'gpu').length
  if (cpu && accelerator) return `${cpu} CPU · ${accelerator} accelerator`
  if (cpu) return `${cpu} calls on CPU`
  return `${accelerator} calls on accelerator`
}

export function BakeoffResolution() {
  const cached = getCachedProof<BakeoffResponse>('latest-bakeoff')
  const proof = cached?.data ? cached : { status: 'ready' as const, source: 'rehearsal' as const, data: bakeoffFixture }
  const completed = proof.data!.runs.filter((run) => run.status === 'completed' && run.result && run.evaluation && run.modeled_cost)
  const passing = completed.filter((run) => run.evaluation!.passed)
  const lowestCost = [...passing].sort((a, b) => a.modeled_cost!.cost_per_1000_tasks_usd - b.modeled_cost!.cost_per_1000_tasks_usd || a.result!.execution_ms - b.result!.execution_ms)[0]
  const fastest = [...completed].sort((a, b) => a.result!.execution_ms - b.result!.execution_ms)[0]
  const threshold = completed[0]?.evaluation?.threshold_pct ?? 80

  return <SceneFrame scene={{
    id: 'bakeoff-resolution',
    beat: 'trials',
    eyebrow: 'Resolution',
    title: 'Three policies ran the same case. Here is what changed.',
    body: 'Separate what stayed constant from what the compute policy changed.',
  }}>
    <div className="resolution-shell" data-testid="bakeoff-resolution">
      <div className="resolution-common">
        <div><span>HELD CONSTANT</span><strong>{proof.data!.case_title}</strong></div>
        <ul>
          <li>Same input</li>
          <li>Same prompts</li>
          <li>Same MCP evidence</li>
          <li>Same {threshold}% quality gate</li>
          <li>Same API contract</li>
        </ul>
        <span className={`source-badge source-${proof.source ?? 'rehearsal'}`}>{proof.source ?? 'rehearsal'}</span>
      </div>

      <div className="resolution-lanes">
        {completed.map((run) => <article className={`resolution-lane ${lowestCost?.policy === run.policy ? 'selected' : ''}`} key={run.policy}>
          <header><span>{labels[run.policy]}</span>{lowestCost?.policy === run.policy && <b>LOWEST-COST PASS</b>}</header>
          <strong>{placement(run)}</strong>
          <div className="resolution-metrics">
            <div><span>Execution</span><b>{run.result!.execution_ms}ms</b></div>
            <div><span>Cost / 1K</span><b>${run.modeled_cost!.cost_per_1000_tasks_usd.toFixed(2)}</b></div>
            <div><span>Quality</span><b>{run.evaluation!.score_pct}%</b></div>
          </div>
          <EvaluationExplanation evaluation={run.evaluation!} />
          <small>{run.policy === 'cpu_only' ? 'Lowest infrastructure cost when CPU capacity already exists.' : run.policy === 'gpu_only' ? 'Maximum acceleration, with accelerator cost on every model call.' : 'Structured work on CPU; harder synthesis on the accelerator.'}</small>
        </article>)}
      </div>

      <div className="resolution-decision">
        <span>WHAT THE RESULT MEANS</span>
        <strong>{lowestCost ? `${labels[lowestCost.policy]} is the lowest-cost policy that passed quality.` : 'No policy cleared the quality gate.'}</strong>
        {fastest && <small>{labels[fastest.policy]} was fastest. Speed and lowest acceptable cost are different decisions.</small>}
      </div>
    </div>
  </SceneFrame>
}
