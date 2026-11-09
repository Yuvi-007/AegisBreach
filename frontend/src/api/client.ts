import type {
  Health,
  MutatorInfo,
  RunAccepted,
  RunDetail,
  RunRequest,
  RunSummary,
  SuiteInfo,
} from './types'

// Empty in development: Vite proxies /api to the backend (see vite.config.ts).
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/** status 0 means the backend could not be reached at all. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isOffline(): boolean {
    return this.status === 0
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError(0, error instanceof Error ? error.message : String(error))
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  apiKey?: string | null
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.apiKey) headers['X-API-Key'] = options.apiKey

  let response: Response
  try {
    response = await fetch(`${BASE_URL}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError(0, 'Cannot reach the AegisBreach backend.')
  }

  // A proxy in front of the API (Vite in development, nginx etc. in production)
  // answers 502/504 when the backend is down. The backend itself never sends
  // these, so treat them as "can't reach the backend".
  if (response.status === 502 || response.status === 504) {
    throw new ApiError(0, 'Cannot reach the AegisBreach backend.')
  }
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response))
  }
  return (await response.json()) as T
}

/** FastAPI puts a string in `detail` for HTTPException and a list for 422s. */
async function readDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const detail = (body as { detail?: unknown })?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((item) => (item as { msg?: string })?.msg)
        .filter(Boolean)
        .join('; ')
    }
  } catch {
    // Not JSON; fall through to the status text.
  }
  return response.statusText || `Request failed with HTTP ${response.status}`
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/health', { signal }),
  mutators: (apiKey: string | null, signal?: AbortSignal) =>
    request<MutatorInfo[]>('/mutators', { apiKey, signal }),
  suites: (apiKey: string | null, signal?: AbortSignal) =>
    request<SuiteInfo[]>('/suites', { apiKey, signal }),
  startRun: (apiKey: string | null, body: RunRequest) =>
    request<RunAccepted>('/run', { method: 'POST', apiKey, body }),
  run: (apiKey: string | null, runId: string, signal?: AbortSignal) =>
    request<RunDetail>(`/runs/${encodeURIComponent(runId)}`, { apiKey, signal }),
  runs: (apiKey: string | null, limit = 50, signal?: AbortSignal) =>
    request<RunSummary[]>(`/runs?limit=${limit}`, { apiKey, signal }),
}
