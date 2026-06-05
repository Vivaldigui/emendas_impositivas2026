import { NextRequest, NextResponse } from "next/server";

import { coletarEmpenhos } from "@/collectors/sonner/empenhosCollector";
import {
  listStoredEmpenhosArtifacts,
  readColetaLogs,
} from "@/services/empenhosStorage";
import { getAdminAuthStatus, isAuthorizedAdmin } from "@/lib/adminAuth";
import { todayInSaoPaulo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const [logs, artifacts] = await Promise.all([
    readColetaLogs(80),
    listStoredEmpenhosArtifacts(),
  ]);

  return NextResponse.json({
    logs,
    artifacts: artifacts.map((artifact) => ({
      inicio: artifact.inicio,
      fim: artifact.fim,
      formato: artifact.formato,
      hashArquivo: artifact.hashArquivo,
      nomeArquivo: artifact.nomeArquivo,
      dataColeta: artifact.dataColeta,
      status: artifact.status,
      erro: artifact.erro,
      registrosBrutos: artifact.registrosBrutos,
      registrosImportados: artifact.registrosImportados,
      warnings: artifact.warnings,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) {
    const auth = getAdminAuthStatus(request);
    return NextResponse.json(
      {
        ok: false,
        erro: "Nao autorizado.",
        details: {
          adminSecretConfigurado: auth.configured,
          segredoEnviado: auth.provided,
        },
      },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const fim =
    typeof body.fim === "string" && body.fim
      ? body.fim
      : todayInSaoPaulo().toISOString().slice(0, 10);
  const result = await coletarEmpenhos({
    inicio: typeof body.inicio === "string" && body.inicio ? body.inicio : "2026-01-01",
    fim,
    formato: normalizeFormato(body.formato),
    modo: normalizeModo(body.modo),
    headless: body.debug === true ? false : true,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

function normalizeFormato(value: unknown) {
  if (["excel", "xls", "xlsx", "html", "pdf", "txt"].includes(String(value))) {
    return value as "excel" | "xls" | "xlsx" | "html" | "pdf" | "txt";
  }

  return "excel";
}

function normalizeModo(value: unknown) {
  if (value === "direct" || value === "playwright") {
    return value;
  }

  return "auto";
}
