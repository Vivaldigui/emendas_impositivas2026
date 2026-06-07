import type { LicitacaoRecord } from "@/lib/types";

export const LICITACOES_SOURCE =
  "Portal Cidadao da Prefeitura Municipal de Itanhandu - Licitacoes";

type RawLicitacao = Record<string, unknown>;

function asRecord(value: unknown): RawLicitacao {
  return value && typeof value === "object" ? (value as RawLicitacao) : {};
}

function toYear(value: unknown): number {
  const text = String(value ?? "");
  const match = text.match(/(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIntOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Converte o JSON do relatorio de licitacoes do Portal Cidadao (Sonner GRP)
 * em LicitacaoRecord[]. Aceita o array bruto ou um objeto que o contenha.
 */
export function parseLicitacoes(input: unknown): {
  registros: LicitacaoRecord[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let lista: unknown[] = [];

  if (Array.isArray(input)) {
    lista = input;
  } else if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const candidate =
      obj.registros ?? obj.data ?? obj.list ?? obj.itens ?? obj.licitacoes;
    if (Array.isArray(candidate)) {
      lista = candidate;
    }
  }

  if (!lista.length) {
    warnings.push("Nenhuma licitacao encontrada no JSON informado.");
    return { registros: [], warnings };
  }

  const registros: LicitacaoRecord[] = [];

  for (const item of lista) {
    const raw = asRecord(item);
    const idObj = asRecord(raw.id);
    const ano = toYear(idObj.ano ?? raw.anoProc);
    const numero = toIntOrNull(idObj.numero) ?? 0;

    if (!ano || !numero) {
      continue;
    }

    const modalidade = asRecord(raw.modalidade);
    const justificativa = asRecord(raw.licLicitacaoJustificativa);

    registros.push({
      id: `${ano}-${numero}`,
      ano,
      numero,
      licitacao: toText(raw.licitacao) ?? `${numero}/${ano}`,
      modalidade: toText(modalidade.nome) ?? toText(raw.modalidade),
      processoCompra: toIntOrNull(raw.processoCompra),
      objeto: toText(raw.objetoChar),
      situacao: toText(raw.situacaoStr),
      criterio: toText(raw.critAceitabilidade),
      orgaoResp: toText(raw.orgaoResp),
      valorEstimado: toNumber(raw.valorestimado),
      valorHomologado: toNumber(raw.valorHomologado ?? raw.valorPrevisto),
      razaoFornecedor: toText(justificativa.razaoFornecedor),
      justificativa: toText(justificativa.justificativa),
      dataHomologacao: toIso(raw.dataHomologacao),
      publicacao: toIso(raw.publicacao),
      fonte: LICITACOES_SOURCE,
      linhaBruta: raw,
    });
  }

  if (!registros.length) {
    warnings.push("Nenhuma licitacao valida (com ano e numero) foi reconhecida.");
  }

  return { registros, warnings };
}
