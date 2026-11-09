import { useCallback, useEffect, useRef, useState } from 'react'
import { type ApiError, toApiError } from '../api/client'

export interface Resource<T> {
  data: T | undefined
  error: ApiError | undefined
  loading: boolean
  reload: () => void
}

/**
 * Fetch data, refetch when `deps` change, and optionally poll every `pollMs`.
 * Keeps the last good data while a refresh fails, so screens don't flash empty.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  pollMs: number | null = null,
): Resource<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<ApiError>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      try {
        const next = await loadRef.current(controller.signal)
        if (controller.signal.aborted) return
        setData(next)
        setError(undefined)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(toApiError(err))
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          if (pollMs) timer = setTimeout(run, pollMs)
        }
      }
    }

    setLoading(true)
    void run()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
    // deps are supplied by the caller; tick forces a reload; pollMs restarts polling.
  }, [...deps, tick, pollMs])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}
