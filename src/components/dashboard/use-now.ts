import { useEffect, useState } from "react";

// A clock for "2m ago" labels. It starts at the time the server built the
// page (so server and browser markup match during hydration), then switches
// to the browser's clock and ticks every 30 seconds.
export function useNow(serverIso: string): number {
  const [now, setNow] = useState(() => Date.parse(serverIso) || 0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
