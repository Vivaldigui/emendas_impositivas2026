import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAdminAuthStatus, getAuthorizedAdmin } from "@/lib/adminAuth";
import { analisarVinculosEmendas } from "@/services/aiEmpenhoLinker";
import { invalidateDashboardCache } from "@/services/dashboardService";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  emendaIds: z.array(z.string()).optional(),
  reanalisar: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const admin = getAuthorizedAdmin(request);

  if (!admin) {
    const auth = getAdminAuthStatus(request);
    return NextResponse.json(
      {
        error: "Nao autorizado.",
        details: {
          adminSecretConfigurado: auth.configured,
          segredoEnviado: auth.provided,
        },
      },
      { status: 401 },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Corpo da requisicao invalido.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await analisarVinculosEmendas({
      emendaIds: parsed.data.emendaIds,
      reanalisar: parsed.data.reanalisar,
      dryRun: parsed.data.dryRun,
    });

    if (!parsed.data.dryRun) {
      invalidateDashboardCache();
    }

    return NextResponse.json({
      ...result,
      solicitadoPor: admin.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao executar analise.",
      },
      { status: 500 },
    );
  }
}
