import * as cheerio from "cheerio";
import * as XLSX from "xlsx";

import type { EmpenhoRecord } from "@/lib/types";
import { normalizeText, parseBrazilianCurrency } from "@/lib/utils";

export type EmpenhosParseResult = {
  rows: Record<string, unknown>[];
  registros: EmpenhoRecord[];
  warnings: string[];
};

export function parseEmpenhosFile(input: {
  buffer: Buffer;
  extension: string;
  contentType?: string | null;
  hashArquivo?: string | null;
  fonte?: string;
}): EmpenhosParseResult {
  const extension = input.extension.replace(/^\./, "").toLowerCase();
  const contentType = input.contentType?.toLowerCase() ?? "";
  const warnings: string[] = [];

  let rows: Record<string, unknown>[] = [];

  if (["xls", "xlsx", "excel"].includes(extension)) {
    rows = parseSpreadsheet(input.buffer, warnings);
  } else if (extension === "html" || contentType.includes("html")) {
    rows = parseHtml(input.buffer, warnings);
  } else if (extension === "txt" || extension === "csv" || contentType.includes("text")) {
    rows = parseText(input.buffer, warnings);
  } else if (extension === "pdf" || contentType.includes("pdf")) {
    warnings.push("PDF arquivado, mas nao importado. Prefira Excel ou HTML para registros.");
  } else {
    warnings.push(`Formato ${extension || "desconhecido"} nao suportado para importacao.`);
  }

  const registros = rows
    .map((row, index) =>
      normalizeEmpenhoRow(row, {
        index,
        hashArquivo: input.hashArquivo ?? null,
        fonte: input.fonte ?? "Portal Cidadao da Prefeitura Municipal de Itanhandu",
      }),
    )
    .filter((record): record is EmpenhoRecord => Boolean(record));

  if (rows.length && !registros.length) {
    warnings.push("Parser encontrou linhas, mas nenhuma parecia ser empenho valido.");
  }

  return { rows, registros, warnings };
}

function parseSpreadsheet(buffer: Buffer, warnings: string[]) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    warnings.push("Planilha sem abas.");
    return [];
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(
    sheet,
    {
      header: 1,
      defval: null,
      raw: false,
    },
  );
  const headerIndex = findHeaderIndex(matrix);

  if (headerIndex >= 0) {
    return matrixToRows(matrix.slice(headerIndex));
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });
}

function parseHtml(buffer: Buffer, warnings: string[]) {
  const html = decodeText(buffer);
  const $ = cheerio.load(html);
  const tables = $("table").toArray();
  const table = tables.find((candidate) =>
    normalizeText($(candidate).text()).includes("empenho"),
  );

  if (!table) {
    warnings.push("HTML sem tabela de empenhos localizada.");
    return [];
  }

  const matrix = $(table)
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th,td")
        .toArray()
        .map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
    )
    .filter((row) => row.some(Boolean));

  return matrixToRows(matrix);
}

function parseText(buffer: Buffer, warnings: string[]) {
  const lines = decodeText(buffer)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    warnings.push("Arquivo texto sem linhas suficientes.");
    return [];
  }

  const delimiter = inferDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(cleanHeader);

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return headers.reduce<Record<string, unknown>>((row, header, index) => {
      row[header || `coluna_${index}`] = values[index]?.trim() ?? null;
      return row;
    }, {});
  });
}

function matrixToRows(matrix: Array<Array<unknown>>) {
  if (!matrix.length) {
    return [];
  }

  const headers = matrix[0].map((cell, index) => cleanHeader(cell) || `coluna_${index}`);
  const rows: Record<string, unknown>[] = [];
  let currentEmpenho: Record<string, unknown> | null = null;
  let detailSection: "subEmpenhos" | "documentosPagamento" | null = null;

  for (const row of matrix.slice(1)) {
    if (!row.some(Boolean)) {
      continue;
    }

    const record = rowToRecord(headers, row);

    if (isMainEmpenhoRow(record)) {
      rows.push(record);
      currentEmpenho = record;
      detailSection = null;
      continue;
    }

    if (!currentEmpenho) {
      continue;
    }

    const cells = row.map((cell) => cleanTextValue(cell));
    const lineText = cells.filter(Boolean).join(" ");

    if (!lineText) {
      continue;
    }

    if (normalizeText(lineText) === "sub empenhos") {
      ensureDetalhes(currentEmpenho).subEmpenhos ??= [];
      detailSection = "subEmpenhos";
      continue;
    }

    if (normalizeText(lineText) === "documentos de pagamentos") {
      ensureDetalhes(currentEmpenho).documentosPagamento ??= [];
      detailSection = "documentosPagamento";
      continue;
    }

    if (lineText.toLowerCase().startsWith("processo compra:")) {
      currentEmpenho["Processo Compra"] = lineText;
      ensureDetalhes(currentEmpenho).processoCompraDetalhado = lineText;
      detailSection = null;
      continue;
    }

    if (detailSection === "subEmpenhos") {
      const subEmpenho = parseSubEmpenhoDetail(cells);
      if (subEmpenho) {
        ensureDetalhes(currentEmpenho).subEmpenhos ??= [];
        ensureDetalhes(currentEmpenho).subEmpenhos?.push(subEmpenho);
      }
      continue;
    }

    if (detailSection === "documentosPagamento") {
      const documento = parseDocumentoPagamentoDetail(cells);
      if (documento) {
        ensureDetalhes(currentEmpenho).documentosPagamento ??= [];
        ensureDetalhes(currentEmpenho).documentosPagamento?.push(documento);
      }
      continue;
    }

    const historico = cells[4] ?? lineText;
    if (isHistoricoDetailLine(historico)) {
      currentEmpenho["Histórico"] = appendText(currentEmpenho["Histórico"], historico);
      ensureDetalhes(currentEmpenho).historicoLinhas ??= [];
      ensureDetalhes(currentEmpenho).historicoLinhas?.push(historico);
    }
  }

  return rows;
}

function rowToRecord(headers: string[], row: Array<unknown>) {
  return headers.reduce<Record<string, unknown>>((record, header, index) => {
    record[header] = row[index] ?? null;
    return record;
  }, {});
}

function isMainEmpenhoRow(row: Record<string, unknown>) {
  const field = createFieldReader(row);
  const numeroEmpenho = cleanTextValue(field(["empenho", "numero do empenho"]));
  const credor = cleanTextValue(field(["credor", "fornecedor"]));
  const data = parseDateString(field(["data empenho", "data"]));
  const valorEmpenhado = currencyField(field, ["empenhado", "valor empenhado"]);

  return Boolean(numeroEmpenho && data && credor && valorEmpenhado);
}

type EmpenhoDetalhesBrutos = {
  historicoLinhas?: string[];
  processoCompraDetalhado?: string;
  subEmpenhos?: Array<{
    liquidacao: string | null;
    contexto: string | null;
    data: string | null;
    gestor: string | null;
    historico: string | null;
    valor: number | null;
  }>;
  documentosPagamento?: Array<{
    tipo: string | null;
    numero: string | null;
    dataEmissao: string | null;
    dataVencimento: string | null;
    descricao: string | null;
    valor: number | null;
  }>;
};

function ensureDetalhes(row: Record<string, unknown>) {
  const detalhes =
    typeof row.Detalhes === "object" && row.Detalhes !== null
      ? (row.Detalhes as EmpenhoDetalhesBrutos)
      : {};
  row.Detalhes = detalhes;
  return detalhes;
}

function parseSubEmpenhoDetail(cells: Array<string | null>) {
  const liquidacao = cells[1];
  const contexto = cells[2];
  const data = cells[10];
  const gestor = cells[14];
  const historico = cells[20];
  const valor = parseBrazilianCurrency(cells[34]);

  if (!liquidacao || normalizeText(liquidacao) === "liq") {
    return null;
  }

  if (!historico && !valor) {
    return null;
  }

  return { liquidacao, contexto, data, gestor, historico, valor };
}

function parseDocumentoPagamentoDetail(cells: Array<string | null>) {
  const tipo = cells[1];
  const numero = cells[5];
  const dataEmissao = cells[9];
  const dataVencimento = cells[13];
  const descricao = cells[16];
  const valor = parseBrazilianCurrency(cells[32]);

  if (!tipo || normalizeText(tipo) === "tipo") {
    return null;
  }

  if (!numero && !valor) {
    return null;
  }

  return { tipo, numero, dataEmissao, dataVencimento, descricao, valor };
}

function isHistoricoDetailLine(value: string | null) {
  if (!value) {
    return false;
  }

  const normalized = normalizeText(value);
  return (
    normalized.length > 12 &&
    !normalized.startsWith("processo compra") &&
    normalized !== "sub empenhos" &&
    normalized !== "documentos de pagamentos"
  );
}

function appendText(current: unknown, next: string) {
  const previous = cleanTextValue(current);
  if (!previous) {
    return next;
  }

  if (previous.includes(next)) {
    return previous;
  }

  return `${previous} ${next}`;
}

function findHeaderIndex(matrix: Array<Array<unknown>>) {
  return matrix.findIndex((row) => {
    const normalized = normalizeText(row.map((cell) => String(cell ?? "")).join(" "));
    return (
      normalized.includes("empenho") &&
      (normalized.includes("fornecedor") ||
        normalized.includes("historico") ||
        normalized.includes("credor"))
    );
  });
}

function normalizeEmpenhoRow(
  row: Record<string, unknown>,
  meta: { index: number; hashArquivo: string | null; fonte: string },
): EmpenhoRecord | null {
  const field = createFieldReader(row);
  const numeroEmpenho = cleanTextValue(
    field(["empenho", "numero do empenho", "n empenho", "num empenho"]) ??
      extractEmpenhoNumber(row),
  );
  const valorEmpenhado = currencyField(field, [
    "valor empenhado",
    "empenhado",
    "valor",
    "valor empenho",
  ]);
  const valorLiquidado = currencyField(field, ["valor liquidado", "liquidado"]);
  const valorPago = currencyField(field, ["valor pago", "pago", "pagamento"]);
  const historico = stringField(field, ["historico", "historico empenho", "descricao", "objeto"]);

  if (!numeroEmpenho && !historico && !valorEmpenhado) {
    return null;
  }

  return {
    id: `${meta.hashArquivo ?? "manual"}-${numeroEmpenho ?? meta.index}`,
    ano: numberField(field, ["ano", "exercicio"]) ?? inferYear(field(["data empenho", "data"])),
    numeroEmpenho,
    dataEmpenho: parseDateString(field(["data empenho", "data", "emissao"])),
    fornecedor: stringField(field, ["fornecedor", "credor", "beneficiario"]),
    cnpjCpfFornecedor: stringField(field, ["cnpj", "cpf", "cnpj/cpf"]),
    historico,
    secretaria: stringField(field, ["secretaria", "orgao", "unidade", "atividade"]),
    dotacao: stringField(field, ["dotacao", "ficha dotacao", "classificacao", "funcional"]),
    unidadeOrcamentaria: stringField(field, [
      "unidade orcamentaria",
      "unidade orc",
      "unidade",
      "orgao",
    ]),
    naturezaDespesa: stringField(field, [
      "natureza da despesa",
      "natureza despesa",
      "elemento",
      "categoria economica",
    ]),
    modalidadeAplicacao: stringField(field, [
      "modalidade de aplicacao",
      "modalidade aplicacao",
      "modalidade",
    ]),
    fonteRecurso: stringField(field, [
      "fonte de recurso",
      "fonte recurso",
      "fonte",
      "recurso",
    ]),
    ficha: stringField(field, ["ficha", "ficha despesa"]),
    processoCompra: stringField(field, ["processo compra", "processo de compra", "processo"]),
    valorEmpenhado,
    valorLiquidado,
    valorPago,
    situacao: stringField(field, ["situacao", "status"]),
    fonte: meta.fonte,
    hashArquivo: meta.hashArquivo,
    linhaBruta: row,
  };
}

function createFieldReader(row: Record<string, unknown>) {
  const entries = Object.entries(row).map(([key, value]) => [normalizeText(key), value] as const);

  return (names: string[]) => {
    const normalizedNames = names.map(normalizeText);
    const exact = entries.find(([key]) => normalizedNames.includes(key));
    if (exact) {
      return exact[1];
    }

    const fuzzy = entries.find(([key]) =>
      normalizedNames.some((name) => key.includes(name)),
    );

    return fuzzy?.[1] ?? null;
  };
}

function stringField(
  field: ReturnType<typeof createFieldReader>,
  names: string[],
) {
  return cleanTextValue(field(names));
}

function cleanTextValue(value: unknown) {

  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function currencyField(
  field: ReturnType<typeof createFieldReader>,
  names: string[],
) {
  return parseBrazilianCurrency(field(names));
}

function numberField(
  field: ReturnType<typeof createFieldReader>,
  names: string[],
) {
  const value = field(names);
  const parsed = Number(String(value ?? "").replace(/[^\d-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractEmpenhoNumber(row: Record<string, unknown>) {
  const text = Object.values(row).join(" ");
  const match = text.match(/\b(?:empenho|emp)\D{0,10}(\d{1,8})\b/i);
  return match?.[1] ?? null;
}

function inferYear(value: unknown) {
  const date = parseDateString(value);
  if (!date) {
    return new Date().getFullYear();
  }

  return Number(date.slice(0, 4));
}

function parseDateString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const text = String(value ?? "").trim();
  const brazilian = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (brazilian) {
    const [, day, month, year] = brazilian;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00.000Z`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cleanHeader(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim();
}

function inferDelimiter(headerLine: string) {
  return [";", "\t", ","]
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

function decodeText(buffer: Buffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);

  if (utf8.includes("\uFFFD")) {
    return new TextDecoder("windows-1252").decode(buffer);
  }

  return utf8;
}
