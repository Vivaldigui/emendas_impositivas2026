import licitacoes2026 from "@/data/licitacoes-2026.json";
import { parseLicitacoes } from "@/collectors/sonner/licitacoesParser";
import type { LicitacaoRecord } from "@/lib/types";
import type { Prisma } from "../../generated/prisma/client";
import { isDatabaseConfigured, prisma } from "../../lib/prisma";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "Licitacao" (
  "id" TEXT NOT NULL,
  "ano" INTEGER NOT NULL,
  "numero" INTEGER NOT NULL,
  "licitacao" TEXT,
  "modalidade" TEXT,
  "processoCompra" INTEGER,
  "objeto" TEXT,
  "situacao" TEXT,
  "criterio" TEXT,
  "orgaoResp" TEXT,
  "valorEstimado" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "valorHomologado" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "razaoFornecedor" TEXT,
  "justificativa" TEXT,
  "dataHomologacao" TIMESTAMP(3),
  "publicacao" TIMESTAMP(3),
  "fonte" TEXT NOT NULL,
  "linhaBruta" JSONB,
  "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Licitacao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Licitacao_processoCompra_idx" ON "Licitacao"("processoCompra");
CREATE INDEX IF NOT EXISTS "Licitacao_ano_numero_idx" ON "Licitacao"("ano", "numero");
`;

let tableEnsured = false;
let seedAttempted = false;

/** Cria a tabela Licitacao se nao existir (idempotente). */
export async function ensureLicitacaoTable(): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  if (tableEnsured) return true;
  try {
    await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
    tableEnsured = true;
    return true;
  } catch {
    return false;
  }
}

/** Carrega as licitacoes de 2026 embutidas, uma unica vez, se a tabela estiver vazia. */
export async function ensureLicitacoesSeeded(): Promise<void> {
  if (!isDatabaseConfigured() || seedAttempted) return;
  seedAttempted = true;
  const ok = await ensureLicitacaoTable();
  if (!ok) return;
  try {
    const total = await prisma.licitacao.count();
    if (total > 0) return;
    const { registros } = parseLicitacoes(licitacoes2026);
    if (registros.length) {
      await syncLicitacoesToDatabase(registros);
    }
  } catch {
    // sem permissao/sem tabela — segue sem enriquecimento
  }
}

export type LicitacaoSyncResumo = {
  ok: boolean;
  recebidas: number;
  gravadas: number;
  total: number;
  erro?: string | null;
};

function onlyDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function toCreateData(registro: LicitacaoRecord): Prisma.LicitacaoCreateInput {
  return {
    id: registro.id,
    ano: registro.ano,
    numero: registro.numero,
    licitacao: registro.licitacao,
    modalidade: registro.modalidade,
    processoCompra: registro.processoCompra,
    objeto: registro.objeto,
    situacao: registro.situacao,
    criterio: registro.criterio,
    orgaoResp: registro.orgaoResp,
    valorEstimado: registro.valorEstimado,
    valorHomologado: registro.valorHomologado,
    razaoFornecedor: registro.razaoFornecedor,
    justificativa: registro.justificativa,
    dataHomologacao: registro.dataHomologacao ? new Date(registro.dataHomologacao) : null,
    publicacao: registro.publicacao ? new Date(registro.publicacao) : null,
    fonte: registro.fonte,
    linhaBruta: registro.linhaBruta
      ? (JSON.parse(JSON.stringify(registro.linhaBruta)) as Prisma.InputJsonValue)
      : undefined,
  };
}

export async function syncLicitacoesToDatabase(
  registros: LicitacaoRecord[],
): Promise<LicitacaoSyncResumo> {
  if (!isDatabaseConfigured()) {
    return { ok: false, recebidas: registros.length, gravadas: 0, total: 0, erro: "DATABASE_URL nao configurada." };
  }

  await ensureLicitacaoTable();

  try {
    let gravadas = 0;
    for (const registro of registros) {
      const data = toCreateData(registro);
      await prisma.licitacao.upsert({
        where: { id: registro.id },
        create: data,
        update: data,
      });
      gravadas += 1;
    }
    const total = await prisma.licitacao.count();
    return { ok: true, recebidas: registros.length, gravadas, total };
  } catch (error) {
    return {
      ok: false,
      recebidas: registros.length,
      gravadas: 0,
      total: 0,
      erro: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Mapa processoCompra -> objeto da licitacao, para enriquecer empenhos.
 * Indexa por "ano:processo" (preciso) e por "processo" (fallback).
 * Degrada graciosamente se a tabela ainda nao existir.
 */
export async function loadObjetosLicitacaoByProcesso(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!isDatabaseConfigured()) {
    return mapa;
  }

  await ensureLicitacoesSeeded();

  try {
    const rows = await prisma.licitacao.findMany({
      where: { processoCompra: { not: null }, objeto: { not: null } },
      select: { ano: true, processoCompra: true, objeto: true },
    });

    for (const row of rows) {
      if (row.processoCompra === null || !row.objeto) continue;
      const num = String(row.processoCompra);
      mapa.set(`${row.ano}:${num}`, row.objeto);
      // fallback so registra se ainda nao houver conflito de numero entre anos
      if (!mapa.has(num)) {
        mapa.set(num, row.objeto);
      }
    }
  } catch {
    // tabela ainda nao migrada — sem enriquecimento, sem quebrar
    return mapa;
  }

  return mapa;
}

/**
 * Resolve o objeto da licitacao para um empenho, pelo processoCompra.
 */
export function objetoParaProcesso(
  mapa: Map<string, string>,
  ano: number,
  processoCompra: string | null | undefined,
): string | null {
  const num = onlyDigits(processoCompra);
  if (!num) return null;
  return mapa.get(`${ano}:${num}`) ?? mapa.get(num) ?? null;
}

export async function contarLicitacoes(): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureLicitacoesSeeded();
  try {
    return await prisma.licitacao.count();
  } catch {
    return 0;
  }
}
