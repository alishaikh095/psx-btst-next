import { NextResponse } from "next/server";
import { clockOffsetMs, syncClock } from "@/lib/clock";
import { CONFIG } from "@/lib/config";
import { marketState, pkt } from "@/lib/marketHours";
import { sourceLabel, sourceProblem } from "@/lib/dataSource";

export const dynamic = "force-dynamic";

export async function GET() {
  await syncClock();
  const now = pkt();
  return NextResponse.json({
    ...marketState(now),
    nowPkt: `${now.date} ${now.time}`,
    btstIntervalMin: CONFIG.btstIntervalMin,
    monitorIntervalMin: CONFIG.monitorIntervalMin,
    strategy: CONFIG.strategy,
    dataSource: sourceLabel(),
    dataProblem: sourceProblem(),
    clockOffsetMin: Math.round(clockOffsetMs() / 60_000),
  });
}
