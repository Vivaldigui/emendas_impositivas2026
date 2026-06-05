import { NextRequest, NextResponse } from "next/server";

import { coletarEmpenhos } from "@/collectors/sonner/empenhosCollector";
import { analisarVinculosEmendas } from "@/services/aiEmpenhoLinker";
import { invalidateDashboardCache } from "@/services/dashboardService";
import { appendColetaLog } from "@/services/empenhosStorage";
import { todayInSaoPaulo } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, erro: "Nao autorizado." }, { status: 401 });
  }

  const coleta = await coletarEmpenhos({
    inicio: "2026-01-01",
    fim: todayInSaoPaulo().toISOString().slice(0, 10),
    formato: "excel",
    modo: "auto",
    headless: true,
  });

  let analiseIa: Awaited<ReturnType<typeof analisarVinculosEmendas>> | null = null;
  let analiseErro: string | null = null;

  if (coleta.ok) {
    try {
      analiseIa = await analisarVinculosEmendas({ reanalisar: false });
      await appendColetaLog({
        timestamp: new Date().toISOString(),
        status: analiseIa.ok ? "SUCESSO" : "PARCIAL",
        etapa: "ia.analisar-pos-coleta",
        mensagem: `IA analisou ${analiseIa.resumo.analisadas} emenda(s): ${analiseIa.resumo.sugeridas} sugerida(s), ${analiseIa.resumo.conferir} conferir, ${analiseIa.resumo.reaproveitadas} cache, ${analiseIa.resumo.erros} erro(s).`,
        erro: null,
        metadados: analiseIa.resumo,
      });
    } catch (error) {
      analiseErro = error instanceof Error ? error.message : String(error);
      await appendColetaLog({
        timestamp: new Date().toISOString(),
        status: "ERRO",
        etapa: "ia.analisar-pos-coleta",
        mensagem: "Falha ao executar análise pós-coleta.",
        erro: analiseErro,
      });
    }
  }

  invalidateDashboardCache();

  const dbSync = coleta.artifact?.dbSync ?? null;
  return NextResponse.json(
    {
      ok: coleta.ok && analiseErro === null,
      coleta: {
        status: coleta.status,
        mensagem: coleta.mensagem,
        erro: coleta.erro,
        registrosImportados: coleta.artifact?.registrosImportados ?? 0,
      },
      banco: dbSync
        ? {
            ok: dbSync.ok,
            novos: dbSync.novos,
            atualizados: dbSync.atualizados,
            totalAntes: dbSync.totalAntes,
            totalDepois: dbSync.totalDepois,
            erro: dbSync.erro ?? null,
          }
        : { ok: false, motivo: "DATABASE_URL nao configurada." },
      ia: analiseIa
        ? { ok: analiseIa.ok, resumo: analiseIa.resumo }
        : { ok: false, motivo: analiseErro ?? "IA nao executada (coleta falhou)." },
    },
    { status: coleta.ok ? 200 : 500 },
  );
}

function isCronAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
