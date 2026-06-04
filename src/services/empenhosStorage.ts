import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type { ColetaLogEntry, ColetaStatus, EmpenhoRecord } from "@/lib/types";

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

  return artifact;
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
