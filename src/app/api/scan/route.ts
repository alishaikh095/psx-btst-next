import { NextResponse, type NextRequest } from "next/server";
import { syncClock } from "@/lib/clock";
import { CONFIG, type Universe } from "@/lib/config";
import { runScan, runSwingScan } from "@/lib/scanner";
import { sourceProblem } from "@/lib/dataSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const u = (q.get("universe") ?? CONFIG.defaultUniverse).toUpperCase();
  const universe: Universe = u === "KMIALLSHR" || u === "BOTH" ? u : "KMI30";
  const problem = sourceProblem();
  if (problem) return NextResponse.json({ error: problem }, { status: 500 });
  await syncClock();
  try {
    const result = q.get("mode") === "swing" ? await runSwingScan(universe) : await runScan(universe);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
