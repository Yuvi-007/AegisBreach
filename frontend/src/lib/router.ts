import { useEffect, useState } from 'react'

export type Route =
  | { page: 'new' }
  | { page: 'history' }
  | { page: 'run'; runId: string }

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  const run = /^\/runs\/([\w-]+)$/.exec(path)
  if (run) return { page: 'run', runId: run[1] }
  if (path === '/runs') return { page: 'history' }
  return { page: 'new' }
}

/** Tiny hash router: #/ (new test), #/runs (history), #/runs/<id> (one run). */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function hrefFor(route: Route): string {
  switch (route.page) {
    case 'new':
      return '#/'
    case 'history':
      return '#/runs'
    case 'run':
      return `#/runs/${route.runId}`
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route)
}
