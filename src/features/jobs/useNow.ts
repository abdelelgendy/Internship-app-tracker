import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every minute, so "posted 3 hours ago", gate verdicts and
 * due follow-ups stay true while a page is left open.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
