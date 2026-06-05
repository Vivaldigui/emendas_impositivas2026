import { NextResponse } from "next/server";

import { getDashboardData } from "@/services/dashboardService";

// Revalidate a cada 60s: aproveita cache do Next entre requests e mantém
// dados quase em tempo real. invalidateDashboardCache no cron/admin força
// recompute na próxima visita.
export const revalidate = 60;

export async function GET() {
  return NextResponse.json(await getDashboardData());
}
