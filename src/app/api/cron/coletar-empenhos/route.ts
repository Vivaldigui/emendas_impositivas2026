import { NextRequest, NextResponse } from "next/server";

import { coletarEmpenhos } from "@/collectors/sonner/empenhosCollector";
import {
  analisarVinculosEmendas,
  encontrarEmendasAfetadasPorEmpenhos,
} from "@/services/aiEmpenhoLinker";
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

  const dbSync = coleta.artifact?.dbSync ?? null;
  const empenhosAlterados = dbSync?.ok
    ? Array.from(new Set([...(dbSync.novosIds ?? []), ...(dbSync.atualizadosIds ?? [])]))
    : [];

  if (coleta.ok && empenhosAlterados.length > 0) {
    try {
      const emendaIdsAfetadas = await encontrarEmendasAfetadasPorEmpenhos(empenhosAlterados);

      if (emendaIdsAfetadas.length) {
        analiseIa = await analisarVinculosEmendas({
          emendaIds: emendaIdsAfetadas,
          reanalisar: false,
        });
      }

      await appendColetaLog({
        timestamp: new Date().toISOString(),
        status: analiseIa?.ok !== false ? "SUCESSO" : "PARCIAL",
        etapa: "ia.analisar-pos-coleta",
        mensagem: analiseIa
          ? `IA analisou ${analiseIa.resumo.analisadas} emenda(s) afetada(s): ${analiseIa.resumo.sugeridas} sugerida(s), ${analiseIa.resumo.conferir} conferir, ${analiseIa.resumo.reaproveitadas} cache, ${analiseIa.resumo.erros} erro(s).`
          : "IA nao executada: nenhum candidato forte localizado para empenhos novos/alterados.",
        erro: null,
        metadados: analiseIa?.resumo ?? { empenhosAlterados: empenhosAlterados.length },
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
  } else if (coleta.ok) {
    await appendColetaLog({
      timestamp: new Date().toISOString(),
      status: "SUCESSO",
      etapa: "ia.analisar-pos-coleta",
      mensagem: "IA nao executada: nenhum empenho inedito ou alterado na coleta.",
      erro: null,
      metadados: dbSync
        ? {
            novos: dbSync.novos,
            atualizados: dbSync.atualizados,
            inalterados: dbSync.inalterados,
          }
        : undefined,
    });
  }

  invalidateDashboardCache();

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
            inalterados: dbSync.inalterados,
            totalAntes: dbSync.totalAntes,
            totalDepois: dbSync.totalDepois,
            erro: dbSync.erro ?? null,
          }
        : { ok: false, motivo: "DATABASE_URL nao configurada." },
      ia: analiseIa
        ? { ok: analiseIa.ok, resumo: analiseIa.resumo }
        : {
            ok: false,
            motivo:
              analiseErro ??
              (coleta.ok
                ? "IA nao executada: sem empenho novo/alterado ou sem candidato forte."
                : "IA nao executada (coleta falhou)."),
          },
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
