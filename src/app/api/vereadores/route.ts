import { NextResponse } from "next/server";

import { getVereadoresResumo } from "@/services/dashboardService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getVereadoresResumo());
}
