import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseEmpenhosFile } from "@/collectors/sonner/empenhosParser";
import { coletarEmpenhosComPlaywright } from "@/collectors/sonner/empenhosPlaywright";
import {
  EMPENHOS_SOURCE,
  appendColetaLog,
  detectEmpenhosExtension,
  looksLikeErrorPayload,
  saveEmpenhosArtifact,
} from "@/services/empenhosStorage";
import { todayInSaoPaulo } from "@/lib/utils";

type ColetarEmpenhosInput = {
  inicio: string;
  fim: string;
  formato: "excel" | "xls" | "xlsx" | "html" | "pdf" | "txt";
  modo: "auto" | "direct" | "playwright";
  headless?: boolean;
};

export async function coletarEmpenhos(input: ColetarEmpenhosInput) {
  if (input.modo === "playwright") {
    return coletarEmpenhosComPlaywright(input);
  }

  const direct = await tentarChamadaDiretaEmpenhos(input);

  if (direct.ok) {
    return direct;
  }

  if (input.modo === "auto") {
    await appendColetaLog({
      timestamp: new Date().toISOString(),
      status: "PARCIAL",
      etapa: "auto.fallback",
      mensagem: "Chamada direta indisponivel; iniciando Playwright publico.",
      erro: direct.erro,
    });

    return coletarEmpenhosComPlaywright({
      ...input,
      fallbackReason: direct.erro,
    });
  }

  return direct;
}

async function tentarChamadaDiretaEmpenhos(input: ColetarEmpenhosInput) {
  const endpoint = process.env.SONNER_EMPENHOS_ENDPOINT;

  if (!endpoint) {
    return {
      ok: false,
      status: "ERRO" as const,
      mensagem: "Endpoint direto de empenhos nao configurado.",
      artifact: null,
      etapas: [],
      erro:
        "SONNER_EMPENHOS_ENDPOINT ausente. Use modo Playwright ou configure o endpoint capturado no DevTools.",
    };
  }

  const payload = buildEmpenhosPayload(input);

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept:
          "application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/html, application/pdf, */*",
        Origin: "https://sistema.itanhandu.mg.gov.br",
        Referer: "https://sistema.itanhandu.mg.gov.br/portalcidadao/",
        "User-Agent": "EmendasItanhandu/0.1 (+coleta-publica-empenhos)",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type");
    const buffer = Buffer.from(await response.arrayBuffer());

    if (!response.ok || !buffer.byteLength || looksLikeErrorPayload(buffer, contentType)) {
      return {
        ok: false,
        status: "ERRO" as const,
        mensagem: "Chamada direta falhou.",
        artifact: null,
        etapas: [],
        erro: `HTTP ${response.status}; resposta nao parece ser arquivo importavel.`,
      };
    }

    const extension = detectEmpenhosExtension({
      buffer,
      contentType,
      requestedFormat: input.formato,
    });
    const parsed = parseEmpenhosFile({
      buffer,
      extension,
      contentType,
      fonte: EMPENHOS_SOURCE,
    });
    const artifact = await saveEmpenhosArtifact({
      buffer,
      inicio: input.inicio,
      fim: input.fim,
      formato: input.formato,
      endpoint,
      parametrosJson: payload,
      contentType,
      registrosBrutos: parsed.rows.length,
      registros: parsed.registros,
      warnings: parsed.warnings,
      status: parsed.warnings.length ? "PARCIAL" : "SUCESSO",
    });

    return {
      ok: artifact.status !== "ERRO",
      status: artifact.status,
      mensagem: "Relatorio de empenhos coletado por chamada direta.",
      artifact,
      etapas: [],
      erro: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: "ERRO" as const,
      mensagem: "Chamada direta falhou.",
      artifact: null,
      etapas: [],
      erro: error instanceof Error ? error.message : "Erro desconhecido.",
    };
  }
}

function buildEmpenhosPayload(input: ColetarEmpenhosInput) {
  return {
    itemDinamico: "AnaliticoEmpenhos",
    ano: 2026,
    periodoDe: isoToBrazilian(input.inicio),
    periodoAte: isoToBrazilian(input.fim),
    formato: input.formato,
    ordenarPor: "EMPENHO",
    quebraPor: "SEM_QUEBRA",
    listarEmpenhosPorHistorico: true,
    todosEmpenhos: true,
    ocultarEmpenhosAnulados: true,
    listarSubEmpenhos: true,
    listarDocumentosPagamentos: true,
    listarProcessoCompraEmpenhos: true,
    situacao: "TODOS",
  };
}

async function runCli() {
  const arquivo = getArg("arquivo");

  if (arquivo) {
    const result = await importarArquivoEmpenhos({
      arquivo,
      inicio: getArg("inicio") ?? "2026-01-01",
      fim: normalizeFim(getArg("fim")),
      formato: normalizeFormato(getArg("formato")),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const input: ColetarEmpenhosInput = {
    inicio: getArg("inicio") ?? "2026-01-01",
    fim: normalizeFim(getArg("fim")),
    formato: normalizeFormato(getArg("formato")),
    modo: normalizeModo(getArg("modo")),
    headless: !process.argv.includes("--debug"),
  };

  const result = await coletarEmpenhos(input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function importarArquivoEmpenhos(input: {
  arquivo: string;
  inicio: string;
  fim: string;
  formato: ColetarEmpenhosInput["formato"];
}) {
  try {
    const buffer = await readFile(input.arquivo);
    const requestedFormat =
      input.formato === "excel"
        ? path.extname(input.arquivo).replace(".", "") || input.formato
        : input.formato;
    const extension = detectEmpenhosExtension({
      buffer,
      requestedFormat,
      contentType: null,
    });
    const parsed = parseEmpenhosFile({
      buffer,
      extension,
      contentType: null,
      fonte: EMPENHOS_SOURCE,
    });
    const artifact = await saveEmpenhosArtifact({
      buffer,
      inicio: input.inicio,
      fim: input.fim,
      formato: input.formato,
      endpoint: "manual-file-import",
      parametrosJson: {
        arquivo: input.arquivo,
        inicio: input.inicio,
        fim: input.fim,
        formato: input.formato,
      },
      contentType: null,
      registrosBrutos: parsed.rows.length,
      registros: parsed.registros,
      warnings: parsed.warnings,
      status: parsed.warnings.length ? "PARCIAL" : "SUCESSO",
    });

    return {
      ok: artifact.status !== "ERRO",
      status: artifact.status,
      mensagem: "Arquivo local de empenhos importado.",
      artifact,
      etapas: [],
      erro: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: "ERRO" as const,
      mensagem: "Falha ao importar arquivo local.",
      artifact: null,
      etapas: [],
      erro: error instanceof Error ? error.message : "Erro desconhecido.",
    };
  }
}

function normalizeFim(value: string | undefined) {
  if (!value || value === "hoje") {
    return todayInSaoPaulo().toISOString().slice(0, 10);
  }

  return value;
}

function normalizeFormato(value: string | undefined): ColetarEmpenhosInput["formato"] {
  if (["excel", "xls", "xlsx", "html", "pdf", "txt"].includes(value ?? "")) {
    return value as ColetarEmpenhosInput["formato"];
  }

  return "excel";
}

function normalizeModo(value: string | undefined): ColetarEmpenhosInput["modo"] {
  if (value === "direct" || value === "playwright") {
    return value;
  }

  return "auto";
}

function getArg(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length);
}

function isoToBrazilian(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
