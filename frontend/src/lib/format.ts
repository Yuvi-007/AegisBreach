/**
 * Percentage for display. Never rounds a non-zero rate to "0%" (one false alarm
 * in 208 is 0.48%, and "0%" would claim there were none) or a non-full rate to "100%".
 */
export function pct(value: number, digits = 0): string {
  const percent = value * 100
  const step = 1 / 10 ** digits
  const shown = percent.toFixed(digits)
  if (percent > 0 && Number(shown) === 0) return `<${step}%`
  if (percent < 100 && Number(shown) === 100) return `>${100 - step}%`
  return `${shown}%`
}

export function ms(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86_400), 'day')
}

export function duration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null
  return ms(new Date(endIso).getTime() - new Date(startIso).getTime())
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}
