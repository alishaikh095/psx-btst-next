import { NextResponse } from "next/server";
import { syncClock } from "@/lib/clock";
import { addPosition, closePosition, deletePosition, getPositions, type NewPosition } from "@/lib/positions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await syncClock();
  try {
    return NextResponse.json(await getPositions());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Body: {action:"add", ...NewPosition} | {action:"close", id, price} | {action:"delete", id} */
export async function POST(req: Request) {
  await syncClock();
  try {
    const b = await req.json();
    if (b.action === "add") {
      const p = b as NewPosition;
      if (!/^[A-Z0-9]{1,12}$/i.test(p.ticker ?? "") || !["BTST", "SWING"].includes(p.kind)
        || !isNum(p.entryPrice) || !isNum(p.target) || !isNum(p.stopLoss)) {
        return NextResponse.json({ error: "invalid position" }, { status: 400 });
      }
      return NextResponse.json(await addPosition(p));
    }
    if (b.action === "close" && typeof b.id === "string" && isNum(b.price)) {
      await closePosition(b.id, b.price);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "delete" && typeof b.id === "string") {
      await deletePosition(b.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
