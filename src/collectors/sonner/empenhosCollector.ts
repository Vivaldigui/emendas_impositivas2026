import "dotenv/config";

import {
  constants as cryptoConstants,
  createCipheriv,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from "node:crypto";
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

const SONNER_REPORT_ENDPOINT =
  "https://sistema.itanhandu.mg.gov.br/GRP/webservices/despesareport/analitico-empenhos";
const SONNER_REPORT_DOWNLOAD_ENDPOINT =
  "https://sistema.itanhandu.mg.gov.br/GRP/servlets/core/downloadReport";
const SONNER_PORTAL_REPORT_REFERER =
  "https://sistema.itanhandu.mg.gov.br/GRP/portal/servicos/report-analiticoempenho-ctp";
const SONNER_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv6KQIeJ894w7Sp4yVYH3baTduRDcp5NLc3dQcjjYEkZAy0KblAjJWHLavV84tzhu+4lWMT1u/Jpd/axnrr0heustbmqhvMrOu35kkyY9b1Vlr10dIov/REkRK0WGY6ij5aGBKMgUU9QXdDTZ0A8QNWKuveKomlu5hxJhj4aC/L+lMpjChpUDBI/wKg/nQ1r+4eFeHIATX/4U4RnY506ti0DBgSebSEXOV/UyAWElZdKld9pQTBEWp33fYVjw7Go45r8qsMw/msH/9v04NQLwUDqiwQH0fLcMYyKdcKs928micVK5bQXPFk7vT8xhhCK7RsRqXND1cXnYOQN4PY/0qQIDAQAB";

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
  const endpoint = process.env.SONNER_EMPENHOS_ENDPOINT?.trim() || SONNER_REPORT_ENDPOINT;
  const useOfficialSonnerReport = endpoint === SONNER_REPORT_ENDPOINT;
  const payload = useOfficialSonnerReport
    ? buildOfficialSonnerEmpenhosPayload(input)
    : buildEmpenhosPayload(input);

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: buildDirectRequestHeaders(useOfficialSonnerReport),
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type");
    const buffer = Buffer.from(await response.arrayBuffer());

    if (!response.ok || !buffer.byteLength) {
      return {
        ok: false,
        status: "ERRO" as const,
        mensagem: "Chamada direta falhou.",
        artifact: null,
        etapas: [],
        erro: `HTTP ${response.status}; ${buffer.toString("utf8").slice(0, 500)}`,
      };
    }

    const captured = looksLikeErrorPayload(buffer, contentType)
      ? await resolveReportJsonPayload(buffer)
      : {
          buffer,
          contentType,
          endpoint,
        };

    const extension = detectEmpenhosExtension({
      buffer: captured.buffer,
      contentType: captured.contentType,
      requestedFormat: input.formato,
    });
    const parsed = parseEmpenhosFile({
      buffer: captured.buffer,
      extension,
      contentType: captured.contentType,
      fonte: EMPENHOS_SOURCE,
    });
    const artifact = await saveEmpenhosArtifact({
      buffer: captured.buffer,
      inicio: input.inicio,
      fim: input.fim,
      formato: input.formato,
      endpoint: captured.endpoint,
      parametrosJson: payload,
      contentType: captured.contentType,
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

async function resolveReportJsonPayload(buffer: Buffer) {
  const json = JSON.parse(buffer.toString("utf8")) as {
    id?: number;
    val0?: string;
    fileName?: string;
    hasError?: boolean;
    error?: unknown;
    errorMessages?: Array<{ message?: string }>;
  };

  if (json.hasError || json.error) {
    const message =
      json.errorMessages
        ?.map((item) => item.message)
        .filter(Boolean)
        .join("; ") || JSON.stringify(json).slice(0, 500);

    throw new Error(`Relatorio retornou erro: ${message}`);
  }

  if (json.id) {
    const downloadUrl = new URL(SONNER_REPORT_DOWNLOAD_ENDPOINT);
    downloadUrl.searchParams.set("relatorioId", String(json.id));
    downloadUrl.searchParams.set("fileName", json.fileName ?? "analiticoEmpenhos.xlsx");
    downloadUrl.searchParams.set("grpEmbed", "1");

    const response = await fetch(downloadUrl, {
      headers: {
        Cookie: "dbConn=1; portalDbConn=1",
        Referer: SONNER_PORTAL_REPORT_REFERER,
      },
    });
    const fileBuffer = Buffer.from(await response.arrayBuffer());

    if (!response.ok || !fileBuffer.byteLength) {
      throw new Error(`Download do relatorio retornou HTTP ${response.status}.`);
    }

    return {
      buffer: fileBuffer,
      contentType: response.headers.get("content-type"),
      endpoint: downloadUrl.toString(),
    };
  }

  if (json.val0) {
    const downloadUrl =
      "https://sistema.itanhandu.mg.gov.br/GRP/servlets/portalcidadao/cadastrosgerais/downloadEncrypted?id=" +
      json.val0;
    const response = await fetch(downloadUrl);
    const fileBuffer = Buffer.from(await response.arrayBuffer());

    if (!response.ok || !fileBuffer.byteLength) {
      throw new Error(`Download criptografado retornou HTTP ${response.status}.`);
    }

    return {
      buffer: fileBuffer,
      contentType: response.headers.get("content-type"),
      endpoint: downloadUrl,
    };
  }

  throw new Error(`Endpoint retornou JSON sem arquivo: ${buffer.toString("utf8").slice(0, 500)}`);
}

function buildOfficialSonnerEmpenhosPayload(input: ColetarEmpenhosInput) {
  return {
    "@type": "br.com.sonner.contabilidade.model.vo.report.AnaliticoEmpenhosReportFilterVO",
    ...emptyContabilidadeReportLists(),
    parameters: {
      "@type": "br.com.sonner.core.client.ui.report.ReportViewParameters",
      reportName: "analiticoEmpenhos.report",
      formato: toSonnerReportFormat(input.formato),
      utilizaModeloPadraoSeModeloNulo: true,
      duracao: 0,
      enviarNotificacao: false,
      enviarEmail: false,
      maxResults: 0,
    },
    competenciaContabilFilterReportVO: {
      "@type": "br.com.sonner.contabilidade.model.vo.CompetenciaContabilFilterReportVO",
      tipo: "PERIODICO",
      inicioPeriodo: `${input.inicio.slice(0, 10)}T00:00:00.000`,
      fimPeriodo: `${input.fim.slice(0, 10)}T00:00:00.000`,
    },
    idExercicioContabil: 26,
    ano: 2026,
    idsEntidades: [1],
    opcaoImpresao: "Empenho",
    opcaoQuebra: "Sem quebra",
    situacao: "Todos",
    empenhoOrdinario: true,
    empenhoEstimativo: true,
    empenhoGlobal: true,
    listarProcessoCompra: true,
    listarDocPagamento: true,
    listarSubempenhos: true,
    listarTodosEmpenhos: true,
    listarHistorico: true,
    ocultarEmpenhosAnulados: true,
  };
}

function emptyContabilidadeReportLists() {
  return {
    idsGrupoFontesRecurso: [],
    idsFontesRecurso: [],
    idsSubFontesRecurso: [],
    idsFornecedores: [],
    idsClasseGestao: [],
    codigosSubElementos: [],
    idsUnidadeGestora: [],
    intervalosFichasDespesa: [],
    intervalosFornecedores: [],
    intervalosFichasReceitas: [],
    intervalosNumeroContaExtra: [],
    intervalosFichasContaFinanceira: [],
    intervalosGrupoFontesRecurso: [],
    intervalosFontesRecurso: [],
    intervalosSubFontesRecurso: [],
    codigosAplicacao: [],
    naturezasMovimentoDotacao: [],
    naturezasMovimentoReceita: [],
    naturezasMovimentacaoFinanceira: [],
    naturezasMovimentoExtra: [],
  };
}

function toSonnerReportFormat(formato: ColetarEmpenhosInput["formato"]) {
  if (formato === "html") return "HTML";
  if (formato === "pdf") return "PDF";
  if (formato === "txt") return "TXT";
  return "XLSX";
}

function buildDirectRequestHeaders(useOfficialSonnerReport: boolean) {
  const base = {
    "Content-Type": "application/json",
    Accept:
      "application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/html, application/pdf, */*",
    Origin: "https://sistema.itanhandu.mg.gov.br",
    Referer: useOfficialSonnerReport
      ? SONNER_PORTAL_REPORT_REFERER
      : "https://sistema.itanhandu.mg.gov.br/portalcidadao/",
    "User-Agent": "EmendasItanhandu/0.1 (+coleta-publica-empenhos)",
  };

  if (!useOfficialSonnerReport) {
    return base;
  }

  return {
    ...base,
    dbConn: "1",
    "grp-embed": "1",
    portalAuth: createPortalAuthHeader(),
    "X-Route-URI": "/GRP/portal/servicos/report-analiticoempenho-ctp",
    "X-System-Mnemonic": "",
    "X-View-Name": "",
    "If-Modified-Since": "Thu, 01 Jan 1970 00:00:01 GMT",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Cookie: "dbConn=1; portalDbConn=1",
  };
}

function createPortalAuthHeader() {
  const payload = JSON.stringify({
    payload: "SonnerSistemas",
    nonce: randomUUID(),
    timestamp: Date.now(),
  });
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const encryptedData = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const encryptedKey = publicEncrypt(
    {
      key: publicKeyPem(),
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    key,
  );

  return JSON.stringify({
    encryptedData: base64Url(encryptedData),
    encryptedKey: base64Url(encryptedKey),
    iv: base64Url(iv),
  });
}

function publicKeyPem() {
  return `-----BEGIN PUBLIC KEY-----\n${SONNER_PUBLIC_KEY.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
