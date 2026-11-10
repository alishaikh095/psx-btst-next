/**
 * Trustworthy "now" for the server. If this computer's clock is wrong, the app
 * would think the market is closed and ask for the wrong time range. We read the
 * time from a web server's Date header and correct for the difference.
 */
import "server-only";
import { setClockCorrection } from "./marketHours";

const TIME_URL = "https://chart.scstrade.com/";
const RESYNC_MS = 10 * 60_000;
const IGNORE_BELOW_MS = 60_000; // small drift doesn't matter

let offsetMs = 0;
let lastSync = 0;
let pending: Promise<void> | null = null;

export const clockOffsetMs = () => offsetMs;

async function doSync() {
  try {
    const t0 = Date.now();
    const res = await fetch(TIME_URL, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(8000) });
    const t1 = Date.now();
    const server = Date.parse(res.headers.get("date") ?? "");
    if (!Number.isFinite(server)) return;
    // Date header has 1s resolution; compare against the request midpoint
    const diff = server + 500 - (t0 + t1) / 2;
    offsetMs = Math.abs(diff) >= IGNORE_BELOW_MS ? diff : 0;
    setClockCorrection(offsetMs);
    lastSync = t1;
    if (offsetMs) console.warn(`System clock is off by ${Math.round(offsetMs / 60_000)} min; correcting.`);
  } catch {
    // offline: keep the previous offset
  }
}

/** Refresh the clock correction (at most every 10 minutes). */
export async function syncClock(): Promise<void> {
  if (Date.now() - lastSync < RESYNC_MS) return;
  pending ??= doSync().finally(() => (pending = null));
  await pending;
}
