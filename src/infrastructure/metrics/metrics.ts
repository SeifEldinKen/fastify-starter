import { collectDefaultMetrics, Histogram, Registry } from '@prometheus-io/client'

// --> Every metric of the app is registered here, GET /metrics returns its content
export const metricsRegistry = new Registry()

// --> Process metrics: memory, CPU, event loop lag, garbage collection
collectDefaultMetrics({ register: metricsRegistry })

// --> One observation per request: gives the request count, the error rate and the response time of every route
// labels must stay a small fixed set: the route pattern, never the real url or a user id
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
})
