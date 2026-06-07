import { NextRequest, NextResponse } from "next/server";

import { getAuthorizedAdmin } from "@/lib/adminAuth";
import { parseLicitacoes } from "@/collectors/sonner/licitacoesParser";
import { syncLicitacoesToDatabase } from "@/services/licitacoesStorage";
import { invalidateDashboardCache } from "@/services/dashboardService";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const admin = getAuthorizedAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json(
      { error: "Corpo invalido. Envie o JSON do relatorio de licitacoes." },
      { status: 400 },
    );
  }

  const { registros, warnings } = parseLicitacoes(body);
  if (!registros.length) {
    return NextResponse.json(
      { ok: false, error: "Nenhuma licitacao reconhecida.", warnings },
      { status: 400 },
    );
  }

  const resumo = await syncLicitacoesToDatabase(registros);

  if (!resumo.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          resumo.erro?.includes("does not exist") || resumo.erro?.includes("relation")
            ? "A tabela de licitacoes ainda nao existe no banco. Rode a migracao (prisma db push) e tente de novo."
            : resumo.erro,
        resumo,
        warnings,
      },
      { status: 500 },
    );
  }

  invalidateDashboardCache();
  return NextResponse.json({ ok: true, resumo, warnings });
}
