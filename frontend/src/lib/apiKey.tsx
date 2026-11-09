import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

const STORAGE_KEY = 'aegisbreach.apiKey'

interface ApiKeyState {
  apiKey: string | null
  saveKey: (key: string) => void
  clearKey: () => void
  /** Ask the shell to open the API key dialog (e.g. after a 401). */
  requestKey: () => void
  dialogOpen: boolean
  setDialogOpen: (open: boolean) => void
}

const ApiKeyContext = createContext<ApiKeyState | null>(null)

function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // storage disabled (private mode, policy)
  }
}

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(readStoredKey)
  const [dialogOpen, setDialogOpen] = useState(false)

  const saveKey = useCallback((key: string) => {
    const trimmed = key.trim()
    setApiKey(trimmed || null)
    try {
      if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Keep it in memory for this tab only.
    }
  }, [])

  const clearKey = useCallback(() => saveKey(''), [saveKey])
  const requestKey = useCallback(() => setDialogOpen(true), [])

  const value = useMemo(
    () => ({ apiKey, saveKey, clearKey, requestKey, dialogOpen, setDialogOpen }),
    [apiKey, saveKey, clearKey, requestKey, dialogOpen],
  )
  return <ApiKeyContext.Provider value={value}>{children}</ApiKeyContext.Provider>
}

export function useApiKey(): ApiKeyState {
  const value = useContext(ApiKeyContext)
  if (!value) throw new Error('useApiKey must be used inside <ApiKeyProvider>')
  return value
}

export function maskKey(key: string): string {
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`
}
