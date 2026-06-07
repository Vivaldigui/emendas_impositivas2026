import type { LicitacaoRecord } from "@/lib/types";
import type { Prisma } from "../../generated/prisma/client";
import { isDatabaseConfigured, prisma } from "../../lib/prisma";

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
  try {
    return await prisma.licitacao.count();
  } catch {
    return 0;
  }
}
