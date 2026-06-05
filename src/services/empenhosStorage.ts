import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type { ColetaLogEntry, ColetaStatus, EmpenhoRecord } from "@/lib/types";
import type { Prisma } from "../../generated/prisma/client";
import { isDatabaseConfigured, prisma } from "../../lib/prisma";

export const EMPENHOS_SOURCE =
  "Portal Cidadao da Prefeitura Municipal de Itanhandu";

export const EMPENHOS_STORAGE_DIR = path.join(
  process.cwd(),
  "storage",
  "sonner",
  "empenhos",
);

export type StoredEmpenhosArtifact = {
  inicio: string;
  fim: string;
  formato: string;
  fonte: string;
  endpoint: string | null;
  parametrosJson: Record<string, unknown>;
  hashArquivo: string;
  caminhoArquivo: string;
  nomeArquivo: string;
  contentType: string | null;
  dataColeta: string;
  status: ColetaStatus;
  erro: string | null;
  tamanhoBytes: number;
  extensao: string;
  registrosBrutos: number;
  registrosImportados: number;
  registros: EmpenhoRecord[];
  warnings: string[];
  dbSync?: DbSyncResumo | null;
};

export type DbSyncResumo = {
  ok: boolean;
  novos: number;
  atualizados: number;
  inalterados: number;
  totalAntes: number;
  totalDepois: number;
  novosIds?: string[];
  atualizadosIds?: string[];
  erro?: string | null;
};

export async function ensureEmpenhosStorageDir() {
  await mkdir(EMPENHOS_STORAGE_DIR, { recursive: true });
  return EMPENHOS_STORAGE_DIR;
}

export function calculateSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function detectEmpenhosExtension(input: {
  buffer: Buffer;
  contentType?: string | null;
  requestedFormat: string;
}) {
  const contentType = input.contentType?.toLowerCase() ?? "";
  const requested = input.requestedFormat.toLowerCase();
  const header = input.buffer.subarray(0, 16);
  const textStart = input.buffer.subarray(0, 120).toString("utf8").trimStart().toLowerCase();

  if (header.subarray(0, 4).toString() === "%PDF" || contentType.includes("pdf")) {
    return "pdf";
  }

  if (contentType.includes("spreadsheetml") || (header[0] === 0x50 && header[1] === 0x4b)) {
    return "xlsx";
  }

  if (contentType.includes("ms-excel") || (header[0] === 0xd0 && header[1] === 0xcf)) {
    return "xls";
  }

  if (contentType.includes("html") || textStart.startsWith("<!doctype") || textStart.startsWith("<html")) {
    return "html";
  }

  if (contentType.includes("csv")) {
    return "csv";
  }

  if (contentType.includes("text/plain")) {
    return "txt";
  }

  if (["xls", "xlsx", "excel", "html", "txt", "csv", "pdf"].includes(requested)) {
    return requested === "excel" ? "xls" : requested;
  }

  return "bin";
}

export function looksLikeErrorPayload(buffer: Buffer, contentType?: string | null) {
  const textStart = buffer.subarray(0, 220).toString("utf8").trimStart();
  const normalizedContentType = contentType?.toLowerCase() ?? "";
  return (
    normalizedContentType.includes("json") ||
    normalizedContentType.includes("javascript") ||
    textStart.startsWith("{") ||
    textStart.startsWith("[")
  );
}

export async function saveEmpenhosArtifact(input: {
  buffer: Buffer;
  inicio: string;
  fim: string;
  formato: string;
  endpoint?: string | null;
  parametrosJson: Record<string, unknown>;
  contentType?: string | null;
  registrosBrutos: number;
  registros: EmpenhoRecord[];
  warnings: string[];
  status?: ColetaStatus;
  erro?: string | null;
}) {
  const storageDir = await ensureEmpenhosStorageDir();
  const hashArquivo = calculateSha256(input.buffer);
  const extension = detectEmpenhosExtension({
    buffer: input.buffer,
    contentType: input.contentType,
    requestedFormat: input.formato,
  });
  const nomeArquivo = `analitico-empenhos-${input.inicio}-${input.fim}.${extension}`;
  const caminhoArquivo = path.join(storageDir, `${hashArquivo}-${nomeArquivo}`);
  const dataColeta = new Date().toISOString();
  const artifact: StoredEmpenhosArtifact = {
    inicio: input.inicio,
    fim: input.fim,
    formato: input.formato,
    fonte: EMPENHOS_SOURCE,
    endpoint: input.endpoint ?? null,
    parametrosJson: input.parametrosJson,
    hashArquivo,
    caminhoArquivo,
    nomeArquivo,
    contentType: input.contentType ?? null,
    dataColeta,
    status: input.status ?? (input.warnings.length ? "PARCIAL" : "SUCESSO"),
    erro: input.erro ?? null,
    tamanhoBytes: input.buffer.byteLength,
    extensao: extension,
    registrosBrutos: input.registrosBrutos,
    registrosImportados: input.registros.length,
    registros: input.registros.map((registro) => ({ ...registro, hashArquivo })),
    warnings: input.warnings,
  };

  await writeFile(caminhoArquivo, input.buffer);
  await writeFile(metadataPath(hashArquivo), JSON.stringify(artifact, null, 2), "utf8");
  await appendColetaLog({
    timestamp: dataColeta,
    status: artifact.status,
    mensagem: `Relatorio de empenhos salvo com ${artifact.registrosImportados} registro(s).`,
    etapa: "arquivo.salvar",
    endpoint: artifact.endpoint,
    hashArquivo,
    caminhoArquivo,
    erro: artifact.erro,
    metadados: {
      inicio: artifact.inicio,
      fim: artifact.fim,
      registrosBrutos: artifact.registrosBrutos,
      registrosImportados: artifact.registrosImportados,
    },
  });

  artifact.dbSync = await syncEmpenhosToDatabase(artifact.registros);

  if (artifact.dbSync) {
    await writeFile(metadataPath(hashArquivo), JSON.stringify(artifact, null, 2), "utf8");
    await appendColetaLog({
      timestamp: new Date().toISOString(),
      status: artifact.dbSync.ok ? "SUCESSO" : "PARCIAL",
      mensagem: artifact.dbSync.ok
        ? `Banco atualizado: ${artifact.dbSync.novos} novo(s), ${artifact.dbSync.atualizados} alterado(s), ${artifact.dbSync.inalterados} inalterado(s). Total agora: ${artifact.dbSync.totalDepois}.`
        : `Falha ao sincronizar com o banco: ${artifact.dbSync.erro ?? "erro desconhecido"}.`,
      etapa: "db.sincronizar",
      erro: artifact.dbSync.erro ?? null,
      metadados: {
        novos: artifact.dbSync.novos,
        atualizados: artifact.dbSync.atualizados,
        inalterados: artifact.dbSync.inalterados,
        totalAntes: artifact.dbSync.totalAntes,
        totalDepois: artifact.dbSync.totalDepois,
      },
    });
  }

  return artifact;
}

export async function syncEmpenhosToDatabase(
  registros: EmpenhoRecord[],
): Promise<DbSyncResumo | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const totalAntes = await prisma.empenho.count();
    const existingRows = await prisma.empenho.findMany({
      where: { id: { in: registros.map((registro) => registro.id) } },
      select: {
        id: true,
        ano: true,
        numeroEmpenho: true,
        dataEmpenho: true,
        fornecedor: true,
        cnpjCpfFornecedor: true,
        historico: true,
        secretaria: true,
        dotacao: true,
        ficha: true,
        processoCompra: true,
        valorEmpenhado: true,
        valorLiquidado: true,
        valorPago: true,
        situacao: true,
        fonte: true,
        hashArquivo: true,
        linhaBruta: true,
      },
    });
    const existingById = new Map(
      existingRows.map((row) => [row.id, row]),
    );
    let novos = 0;
    let atualizados = 0;
    let inalterados = 0;
    const novosIds: string[] = [];
    const atualizadosIds: string[] = [];

    for (const registro of registros) {
      const existing = existingById.get(registro.id);

      if (!existing) {
        await prisma.empenho.create({ data: empenhoCreateData(registro) });
        novos += 1;
        novosIds.push(registro.id);
        continue;
      }

      if (!empenhoChanged(existing, registro)) {
        inalterados += 1;
        continue;
      }

      await prisma.empenho.update({
        where: { id: registro.id },
        data: empenhoUpdateData(registro),
      });
      atualizados += 1;
      atualizadosIds.push(registro.id);
    }

    const totalDepois = await prisma.empenho.count();
    return {
      ok: true,
      novos,
      atualizados,
      inalterados,
      totalAntes,
      totalDepois,
      novosIds,
      atualizadosIds,
    };
  } catch (error) {
    return {
      ok: false,
      novos: 0,
      atualizados: 0,
      inalterados: 0,
      totalAntes: 0,
      totalDepois: 0,
      erro: error instanceof Error ? error.message : String(error),
    };
  }
}

function empenhoCreateData(registro: EmpenhoRecord) {
  return {
    id: registro.id,
    ano: registro.ano,
    numeroEmpenho: registro.numeroEmpenho,
    dataEmpenho: registro.dataEmpenho ? new Date(registro.dataEmpenho) : null,
    fornecedor: registro.fornecedor,
    cnpjCpfFornecedor: registro.cnpjCpfFornecedor ?? null,
    historico: registro.historico,
    secretaria: registro.secretaria,
    dotacao: registro.dotacao,
    ficha: registro.ficha,
    processoCompra: registro.processoCompra,
    valorEmpenhado: registro.valorEmpenhado,
    valorLiquidado: registro.valorLiquidado,
    valorPago: registro.valorPago,
    situacao: registro.situacao,
    fonte: registro.fonte,
    hashArquivo: registro.hashArquivo ?? null,
    linhaBruta: registro.linhaBruta
      ? (JSON.parse(JSON.stringify(registro.linhaBruta)) as Prisma.InputJsonValue)
      : undefined,
  } satisfies Prisma.EmpenhoCreateInput;
}

function empenhoUpdateData(registro: EmpenhoRecord): Prisma.EmpenhoUpdateInput {
  return empenhoCreateData(registro);
}

function empenhoChanged(
  existing: {
    ano: number;
    numeroEmpenho: string | null;
    dataEmpenho: Date | null;
    fornecedor: string | null;
    cnpjCpfFornecedor: string | null;
    historico: string | null;
    secretaria: string | null;
    dotacao: string | null;
    ficha: string | null;
    processoCompra: string | null;
    valorEmpenhado: unknown;
    valorLiquidado: unknown;
    valorPago: unknown;
    situacao: string | null;
    fonte: string;
    hashArquivo: string | null;
    linhaBruta: unknown;
  },
  registro: EmpenhoRecord,
) {
  return (
    existing.ano !== registro.ano ||
    textKey(existing.numeroEmpenho) !== textKey(registro.numeroEmpenho) ||
    dateKey(existing.dataEmpenho) !== dateKey(registro.dataEmpenho) ||
    textKey(existing.fornecedor) !== textKey(registro.fornecedor) ||
    textKey(existing.cnpjCpfFornecedor) !== textKey(registro.cnpjCpfFornecedor) ||
    textKey(existing.historico) !== textKey(registro.historico) ||
    textKey(existing.secretaria) !== textKey(registro.secretaria) ||
    textKey(existing.dotacao) !== textKey(registro.dotacao) ||
    textKey(existing.ficha) !== textKey(registro.ficha) ||
    textKey(existing.processoCompra) !== textKey(registro.processoCompra) ||
    moneyKey(existing.valorEmpenhado) !== moneyKey(registro.valorEmpenhado) ||
    moneyKey(existing.valorLiquidado) !== moneyKey(registro.valorLiquidado) ||
    moneyKey(existing.valorPago) !== moneyKey(registro.valorPago) ||
    textKey(existing.situacao) !== textKey(registro.situacao) ||
    textKey(existing.fonte) !== textKey(registro.fonte) ||
    jsonKey(existing.linhaBruta) !== jsonKey(registro.linhaBruta ?? null)
  );
}

function textKey(value: unknown) {
  return String(value ?? "").trim();
}

function moneyKey(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : "0.00";
}

function dateKey(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function jsonKey(value: unknown) {
  return JSON.stringify(value ?? null);
}

export async function appendColetaLog(entry: ColetaLogEntry) {
  await ensureEmpenhosStorageDir();
  await appendFile(
    path.join(EMPENHOS_STORAGE_DIR, "logs.ndjson"),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}

export async function readColetaLogs(limit = 50) {
  try {
    const text = await readFile(path.join(EMPENHOS_STORAGE_DIR, "logs.ndjson"), "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ColetaLogEntry)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

export async function listStoredEmpenhosArtifacts() {
  try {
    const storageDir = await ensureEmpenhosStorageDir();
    const files = await readdir(storageDir);
    const metadataFiles = files.filter((file) => file.endsWith(".metadata.json"));
    const artifacts = await Promise.all(
      metadataFiles.map(async (file) => {
        const content = await readFile(path.join(storageDir, file), "utf8");
        return JSON.parse(content) as StoredEmpenhosArtifact;
      }),
    );

    return artifacts.sort(
      (left, right) =>
        new Date(right.dataColeta).getTime() - new Date(left.dataColeta).getTime(),
    );
  } catch {
    return [];
  }
}

export async function loadAllEmpenhos() {
  const artifacts = await listStoredEmpenhosArtifacts();
  const byId = new Map<string, EmpenhoRecord>();

  for (const artifact of artifacts) {
    for (const registro of artifact.registros) {
      byId.set(registro.id, {
        ...registro,
        hashArquivo: registro.hashArquivo ?? artifact.hashArquivo,
      });
    }
  }

  return Array.from(byId.values());
}

function metadataPath(hashArquivo: string) {
  return path.join(EMPENHOS_STORAGE_DIR, `${hashArquivo}.metadata.json`);
}
