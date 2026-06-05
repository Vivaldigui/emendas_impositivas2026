import { NextRequest, NextResponse } from "next/server";

import { getAuthorizedAdmin } from "@/lib/adminAuth";
import { getHistoricoRevisoes } from "@/services/aiEmpenhoLinker";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = getAuthorizedAdmin(request);

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const emendaId = url.searchParams.get("emendaId") ?? undefined;
  const vinculoId = url.searchParams.get("vinculoId") ?? undefined;

  return NextResponse.json(await getHistoricoRevisoes({ emendaId, vinculoId }));
}
