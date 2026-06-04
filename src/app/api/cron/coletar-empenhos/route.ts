import { NextRequest, NextResponse } from "next/server";

import { coletarEmpenhos } from "@/collectors/sonner/empenhosCollector";
import { todayInSaoPaulo } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, erro: "Nao autorizado." }, { status: 401 });
  }

  const result = await coletarEmpenhos({
    inicio: "2026-01-01",
    fim: todayInSaoPaulo().toISOString().slice(0, 10),
    formato: "excel",
    modo: "auto",
    headless: true,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

function isCronAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
