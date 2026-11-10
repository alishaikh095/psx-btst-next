/** PSX market-hours helpers. Pakistan has no DST, so PKT is a fixed UTC+5. */
import { CONFIG } from "./config";

// Server-side clock correction (see clock.ts); 0 in the browser.
let correctionMs = 0;
export const setClockCorrection = (ms: number) => { correctionMs = ms; };
export const nowMs = () => Date.now() + correctionMs;

const PKT_OFFSET_MS = 5 * 3600_000;
const toMin = ([h, m]: [number, number]) => h * 60 + m;

export type MarketState = "closed" | "premarket" | "open" | "break" | "btst" | "after";

export interface PktParts {
  weekday: number; // Mon=0 ... Sun=6
  minutes: number; // minutes since midnight PKT
  date: string;    // YYYY-MM-DD (PKT)
  time: string;    // HH:MM:SS (PKT)
}

export function pkt(d: Date = new Date(nowMs())): PktParts {
  const p = new Date(d.getTime() + PKT_OFFSET_MS);
  const iso = p.toISOString();
  return {
    weekday: (p.getUTCDay() + 6) % 7,
    minutes: p.getUTCHours() * 60 + p.getUTCMinutes(),
    date: iso.slice(0, 10),
    time: iso.slice(11, 19),
  };
}

/** PKT calendar date for a unix timestamp (seconds). */
export const pktDateOf = (unixSec: number) =>
  new Date(unixSec * 1000 + PKT_OFFSET_MS).toISOString().slice(0, 10);

export function isTradingDay(p = pkt()): boolean {
  return isTradingDate(p.date);
}

// ---- Calendar helpers on "YYYY-MM-DD" strings ----
const DAY_MS = 86_400_000;
const parseDate = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const weekdayOf = (date: string) => (new Date(parseDate(date)).getUTCDay() + 6) % 7;

export function isTradingDate(date: string): boolean {
  return weekdayOf(date) in CONFIG.sessions && !CONFIG.holidays.includes(date);
}

/** The n-th trading date after `date` (n >= 1). */
export function addTradingDays(date: string, n: number): string {
  let ms = parseDate(date);
  for (let left = n; left > 0;) {
    ms += DAY_MS;
    if (isTradingDate(fmtDate(ms))) left--;
  }
  return fmtDate(ms);
}

export const nextTradingDate = (date: string) => addTradingDays(date, 1);

/** Number of trading dates in (from, to]. */
export function tradingDaysBetween(from: string, to: string): number {
  let count = 0;
  for (let ms = parseDate(from) + DAY_MS; ms <= parseDate(to); ms += DAY_MS) {
    if (isTradingDate(fmtDate(ms))) count++;
  }
  return count;
}

export const calendarDaysBetween = (from: string, to: string) =>
  Math.round((parseDate(to) - parseDate(from)) / DAY_MS);

/** Minutes since midnight PKT when the last session of that weekday ends. */
export function sessionEndMin(weekday: number): number {
  const s = CONFIG.sessions[weekday];
  return s ? toMin(s[s.length - 1][1]) : 0;
}

export function isMarketOpen(p = pkt()): boolean {
  if (!isTradingDay(p)) return false;
  return CONFIG.sessions[p.weekday].some(
    ([s, e]) => p.minutes >= toMin(s) && p.minutes <= toMin(e),
  );
}

export function inBtstWindow(p = pkt()): boolean {
  if (!isTradingDay(p)) return false;
  const [s, e] = CONFIG.btstWindows[p.weekday];
  return p.minutes >= toMin(s) && p.minutes <= toMin(e);
}

export function sessionHours(weekday: number): number {
  return (CONFIG.sessions[weekday] ?? []).reduce(
    (sum, [s, e]) => sum + (toMin(e) - toMin(s)) / 60, 0,
  );
}

export function marketState(p = pkt()): { state: MarketState; label: string } {
  if (!isTradingDay(p)) return { state: "closed", label: "Market closed (weekend/holiday)" };
  if (inBtstWindow(p)) return { state: "btst", label: "BTST window — scanning for signals" };
  if (isMarketOpen(p)) return { state: "open", label: "Market open — monitoring" };
  const sessions = CONFIG.sessions[p.weekday];
  if (p.minutes < toMin(sessions[0][0])) {
    const [h, m] = sessions[0][0];
    return { state: "premarket", label: `Pre-market (opens ${h}:${String(m).padStart(2, "0")})` };
  }
  if (sessions.length > 1 && p.minutes < toMin(sessions[1][0])) {
    return { state: "break", label: "Friday break (resumes 14:32)" };
  }
  return { state: "after", label: "Market closed for the day" };
}
