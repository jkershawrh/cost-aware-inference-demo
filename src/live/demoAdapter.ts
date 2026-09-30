import { createJsonAdapter, registerAdapter } from './adapters'

registerAdapter(createJsonAdapter({
  id: 'demo-proof',
  url: '/api/demo-proof',
  timeoutMs: 2_500,
  rehearsal: {
    data: {
      latency: 612,
      throughput: 42,
      outcome: 'Validated on enterprise infrastructure',
    },
    collectedAt: '2026-01-15T12:00:00.000Z',
  },
}))

registerAdapter(createJsonAdapter({
  id: 'demo-proof-changed',
  url: '/api/demo-proof?condition=changed',
  timeoutMs: 2_500,
  rehearsal: {
    data: {
      latency: 488,
      throughput: 57,
      outcome: 'Changed input selects a different measured path',
    },
    collectedAt: '2026-01-15T12:05:00.000Z',
  },
}))
