import {
  emendas as fallbackEmendas,
  fontesDocumentos as fallbackFontes,
  vereadores as fallbackVereadores,
} from "@/data/emendas";
import type { Emenda, FonteDocumento, Vereador } from "@/lib/types";
import { isDatabaseConfigured, prisma } from "../../lib/prisma";

type Decimalish = { toNumber?: () => number } | number | string | null | undefined;

function decimalToNumber(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return 0;
}

async function safeDb<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDatabaseConfigured()) {
    return fallback;
  }
  try {
    return await loader();
  } catch (error) {
    console.warn("[emendasRepository] usando fallback estatico:", {
      erro: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export async function getVereadores(): Promise<Vereador[]> {
  return safeDb(async () => {
    const rows = await prisma.vereador.findMany({ orderBy: { nome: "asc" } });
    if (!rows.length) return fallbackVereadores;
    return rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      nomeCurto: row.nomeCurto,
      partido: row.partido ?? undefined,
      foto: row.foto,
    }));
  }, fallbackVereadores);
}

export async function getEmendas(): Promise<Emenda[]> {
  return safeDb(async () => {
    const rows = await prisma.emenda.findMany();
    if (!rows.length) return fallbackEmendas;
    return rows.map((row) => ({
      id: row.id,
      vereadorId: row.vereadorId,
      descricao: row.descricao,
      valorAutorizado: decimalToNumber(row.valorAutorizado as Decimalish),
      area: row.area,
      secretaria: row.secretaria,
      codigo: row.codigo,
      acao: row.acao,
      dotacao: row.dotacao,
      fonteDocumentoId: row.fonteDocumento,
    }));
  }, fallbackEmendas);
}

export async function getFontesDocumentos(): Promise<FonteDocumento[]> {
  return fallbackFontes;
}

export async function getEmendaById(id: string): Promise<Emenda | null> {
  const todas = await getEmendas();
  return todas.find((emenda) => emenda.id === id) ?? null;
}

export async function getVereadorById(id: string): Promise<Vereador | null> {
  const todos = await getVereadores();
  return todos.find((vereador) => vereador.id === id) ?? null;
}
