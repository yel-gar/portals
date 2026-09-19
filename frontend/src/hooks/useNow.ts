import { useEffect, useState } from "react";

/**
 * Re-rendering clock. `formatRelative`/`formatTimeLeft` compute against the
 * current time at render; without a ticking state the «только что»/countdown
 * strings stagnate on pages that only re-render when the REST poll fires. This
 * hook re-triggers a render every `intervalMs` so relative times stay fresh.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
