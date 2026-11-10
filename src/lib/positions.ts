/**
 * Open positions (BTST and swing), stored in positions.json, with exit status:
 * target hit, stop hit, or time stop (BTST: next trading day; swing: maxHoldDays).
 */
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { CONFIG } from "./config";
import { addTradingDays, isTradingDay, pkt, sessionEndMin, tradingDaysBetween, type PktParts } from "./marketHours";
import { fetchDaily, fetchIntraday, mapPool } from "./psx";
import type { Bar, Position, PositionKind, PositionView } from "./types";

const file = () => path.join(process.cwd(), "positions.json");
const r2 = (n: number) => Math.round(n * 100) / 100;

async function load(): Promise<Position[]> {
  try { return JSON.parse(await fs.readFile(file(), "utf8")); } catch { return []; }
}
async function save(list: Position[]) {
  await fs.writeFile(file(), JSON.stringify(list, null, 2));
}

export interface NewPosition {
  ticker: string;
  kind: PositionKind;
  setup?: string;
  entryPrice: number;
  target: number;
  stopLoss: number;
  maxHoldDays?: number;
}

export async function addPosition(p: NewPosition): Promise<Position> {
  const today = pkt().date;
  const holdDays = p.kind === "BTST" ? 1 : (p.maxHoldDays ?? CONFIG.swing.maxHoldDays);
  const pos: Position = {
    id: randomUUID(),
    ticker: p.ticker.toUpperCase(),
    kind: p.kind,
    setup: p.setup,
    entryDate: today,
    entryPrice: r2(p.entryPrice),
    target: r2(p.target),
    stopLoss: r2(p.stopLoss),
    exitBy: addTradingDays(today, holdDays),
  };
  const list = await load();
  list.push(pos);
  await save(list);
  return pos;
}

export async function closePosition(id: string, price: number) {
  const list = await load();
  const pos = list.find((p) => p.id === id);
  if (!pos) throw new Error("position not found");
  pos.closed = { date: pkt().date, price: r2(price) };
  await save(list);
}

export async function deletePosition(id: string) {
  await save((await load()).filter((p) => p.id !== id));
}

async function livePrice(ticker: string): Promise<{ price: number | null; today: Bar[] }> {
  const today = await fetchIntraday(ticker);
  if (today.length) return { price: today[today.length - 1].close, today };
  const daily = await fetchDaily(ticker);
  return { price: daily.length ? daily[daily.length - 1].close : null, today };
}

function statusOf(p: Position, price: number | null, today: Bar[], now: PktParts): Pick<PositionView, "status" | "level"> {
  if (price === null) return { status: "No price data", level: "warn" };
  // After the entry day, count today's intraday high/low as touches too
  const hi = now.date > p.entryDate && today.length ? Math.max(price, ...today.map((b) => b.high)) : price;
  const lo = now.date > p.entryDate && today.length ? Math.min(price, ...today.map((b) => b.low)) : price;
  if (price <= p.stopLoss) return { status: "STOP HIT — sell", level: "action" };
  if (price >= p.target) return { status: "TARGET HIT — sell", level: "action" };
  if (lo <= p.stopLoss) return { status: `Stop touched today (low ${lo.toFixed(2)}) — review`, level: "action" };
  if (hi >= p.target) return { status: `Target touched today (high ${hi.toFixed(2)}) — sell / trail stop`, level: "action" };
  if (now.date > p.exitBy) return { status: "OVERDUE — time stop passed, exit", level: "action" };
  if (now.date === p.exitBy) {
    const exitMin = sessionEndMin(now.weekday) - CONFIG.btstExitMinutesBeforeClose;
    if (isTradingDay(now) && now.minutes >= exitMin) return { status: "EXIT NOW — time stop (market closing)", level: "action" };
    return { status: p.kind === "BTST" ? "Sell day — exit by close" : "Last hold day — exit by close", level: "warn" };
  }
  if (p.kind === "BTST" && now.date === p.entryDate) return { status: `Bought today — sell on ${p.exitBy}`, level: "ok" };
  return { status: `Holding — exit by ${p.exitBy}`, level: "ok" };
}

export async function getPositions(): Promise<PositionView[]> {
  const now = pkt();
  const list = await load();
  const open = list.filter((p) => !p.closed);
  const prices = new Map(
    (await mapPool(open, CONFIG.maxConcurrency, async (p) => [p.id, await livePrice(p.ticker)] as const)),
  );
  return list.map((p) => {
    if (p.closed) {
      return {
        ...p, price: p.closed.price, level: "closed" as const, status: `Closed ${p.closed.date}`,
        pnlPct: r2(((p.closed.price - p.entryPrice) / p.entryPrice) * 100),
        daysHeld: tradingDaysBetween(p.entryDate, p.closed.date),
      };
    }
    const { price, today } = prices.get(p.id)!;
    return {
      ...p, price, ...statusOf(p, price, today, now),
      pnlPct: price === null ? null : r2(((price - p.entryPrice) / p.entryPrice) * 100),
      daysHeld: tradingDaysBetween(p.entryDate, now.date),
    };
  }).sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || b.entryDate.localeCompare(a.entryDate));
}
