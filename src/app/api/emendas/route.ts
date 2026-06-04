import { NextRequest, NextResponse } from "next/server";

import { getEmendasResumo } from "@/services/dashboardService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  return NextResponse.json(
    await getEmendasResumo({
      vereadorId: searchParams.get("vereadorId") ?? undefined,
      area: searchParams.get("area") ?? undefined,
      situacao: searchParams.get("situacao") ?? undefined,
      q: searchParams.get("q") ?? undefined,
    }),
  );
}
