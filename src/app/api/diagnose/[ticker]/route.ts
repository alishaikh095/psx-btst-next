import { NextResponse } from "next/server";
import { syncClock } from "@/lib/clock";
import { pkt } from "@/lib/marketHours";
import { fetchDaily, fetchIntraday } from "@/lib/psx";
import { evaluate } from "@/lib/strategy";
import { sourceLabel, sourceProblem } from "@/lib/dataSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const ticker = (await ctx.params).ticker.toUpperCase();
  const problem = sourceProblem();
  if (problem) return NextResponse.json({ error: problem }, { status: 500 });
  await syncClock();
  let daily, intraday;
  try {
    [daily, intraday] = await Promise.all([fetchDaily(ticker), fetchIntraday(ticker)]);
  } catch (e) {
    return NextResponse.json({ ticker, dataSource: sourceLabel(), error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({
    ticker,
    dataSource: sourceLabel(),
    dailyBars: daily.length,
    intradayBars: intraday.length,
    dailyTail: daily.slice(-5),
    intradayTail: intraday.slice(-8),
    evaluation: evaluate(ticker, daily, intraday, pkt()),
  });
}
