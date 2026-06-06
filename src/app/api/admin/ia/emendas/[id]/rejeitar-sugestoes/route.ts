import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthorizedAdmin } from "@/lib/adminAuth";
import { marcarEmendaSemEmpenho } from "@/services/aiEmpenhoLinker";
import { invalidateDashboardCache } from "@/services/dashboardService";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  justificativa: z.string().trim().min(1).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = getAuthorizedAdmin(request);

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));

  try {
    const resultado = await marcarEmendaSemEmpenho({
      emendaId: id,
      revisadoPor: admin.id,
      justificativa: parsed.success ? parsed.data.justificativa : null,
    });

    invalidateDashboardCache();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao marcar emenda." },
      { status: 400 },
    );
  }
}
