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
  totalAntes: number;
  totalDepois: number;
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
        ? `Banco atualizado: ${artifact.dbSync.novos} novo(s), ${artifact.dbSync.atualizados} atualizado(s). Total agora: ${artifact.dbSync.totalDepois}.`
        : `Falha ao sincronizar com o banco: ${artifact.dbSync.erro ?? "erro desconhecido"}.`,
      etapa: "db.sincronizar",
      erro: artifact.dbSync.erro ?? null,
      metadados: {
        novos: artifact.dbSync.novos,
        atualizados: artifact.dbSync.atualizados,
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
    const idsAntes = new Set(
      (await prisma.empenho.findMany({ select: { id: true } })).map((row) => row.id),
    );
    let novos = 0;
    let atualizados = 0;

    for (const registro of registros) {
      const existed = idsAntes.has(registro.id);
      await prisma.empenho.upsert({
        where: { id: registro.id },
        create: empenhoCreateData(registro),
        update: empenhoUpdateData(registro),
      });
      if (existed) atualizados += 1;
      else novos += 1;
    }

    const totalDepois = await prisma.empenho.count();
    return { ok: true, novos, atualizados, totalAntes, totalDepois };
  } catch (error) {
    return {
      ok: false,
      novos: 0,
      atualizados: 0,
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
