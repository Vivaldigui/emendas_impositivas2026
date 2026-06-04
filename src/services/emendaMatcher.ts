import { emendas } from "@/data/emendas";
import type {
  CriterioVinculo,
  Emenda,
  EmendaEmpenhoVinculo,
  EmpenhoRecord,
} from "@/lib/types";
import { normalizeText } from "@/lib/utils";

type MatchCandidate = {
  empenho: EmpenhoRecord;
  criterio: CriterioVinculo;
  confianca: number;
  observacao: string;
};

export function gerarVinculosEmendasEmpenhos(
  empenhos: EmpenhoRecord[],
  baseEmendas: Emenda[] = emendas,
): EmendaEmpenhoVinculo[] {
  const vinculos: EmendaEmpenhoVinculo[] = [];

  for (const emenda of baseEmendas) {
    const matches = matchEmpenhosForEmenda(emenda, empenhos);

    for (const match of matches) {
      vinculos.push({
        emendaId: emenda.id,
        empenhoId: match.empenho.id,
        criterio: match.criterio,
        confianca: match.confianca,
        observacao: match.observacao,
      });
    }
  }

  return vinculos;
}

export function matchEmpenhosForEmenda(
  emenda: Emenda,
  empenhos: EmpenhoRecord[],
): MatchCandidate[] {
  const candidates = empenhos
    .map((empenho) => scoreEmpenho(emenda, empenho))
    .filter((candidate): candidate is MatchCandidate => Boolean(candidate))
    .sort((a, b) => b.confianca - a.confianca);

  if (!candidates.length) {
    return [];
  }

  const best = candidates[0];
  const close = candidates.filter(
    (candidate) =>
      candidate.empenho.id !== best.empenho.id &&
      best.confianca - candidate.confianca <= 0.08 &&
      candidate.confianca < 0.95,
  );

  if (close.length) {
    return [
      {
        ...best,
        criterio: "conferir",
        confianca: Math.min(best.confianca, 0.82),
        observacao:
          "Mais de um empenho ficou muito proximo. Conferencia manual recomendada.",
      },
      ...close.slice(0, 2).map((candidate) => ({
        ...candidate,
        criterio: "conferir" as const,
        confianca: Math.min(candidate.confianca, 0.78),
        observacao:
          "Empenho semelhante ao melhor resultado. Conferencia manual recomendada.",
      })),
    ];
  }

  return [best];
}

function scoreEmpenho(
  emenda: Emenda,
  empenho: EmpenhoRecord,
): MatchCandidate | null {
  const haystack = normalizeText(
    [
      empenho.historico,
      empenho.secretaria,
      empenho.fornecedor,
      empenho.dotacao,
      empenho.ficha,
      empenho.processoCompra,
    ].join(" "),
  );
  const descricao = normalizeText(emenda.descricao);
  const secretaria = normalizeText(emenda.secretaria);
  const codigo = normalizeText(emenda.codigo);
  const acao = normalizeText(emenda.acao);
  const dotacao = normalizeText(empenho.dotacao);

  if (acao && (dotacao.includes(acao) || haystack.includes(acao))) {
    return {
      empenho,
      criterio: "acao_dotacao",
      confianca: 0.98,
      observacao: `Acao/dotacao ${emenda.acao} localizada no empenho.`,
    };
  }

  if (codigo && codigo.length >= 4 && haystack.includes(codigo)) {
    return {
      empenho,
      criterio: "codigo_secretaria",
      confianca: 0.9,
      observacao: `Codigo ou beneficiario "${emenda.codigo}" localizado no empenho.`,
    };
  }

  const textScore = tokenSimilarity(descricao, haystack);
  const secretariaScore =
    secretaria && haystack.includes(secretaria.split(" ")[0] ?? "")
      ? 0.12
      : 0;
  const valueScore = valueProximity(emenda.valorAutorizado, empenho.valorEmpenhado);
  const score = Math.min(0.95, textScore * 0.72 + secretariaScore + valueScore * 0.16);

  if (score >= 0.62) {
    return {
      empenho,
      criterio: "historico_secretaria",
      confianca: score,
      observacao:
        "Historico, secretaria e valor indicam vinculo provavel com a emenda.",
    };
  }

  if (score >= 0.46) {
    return {
      empenho,
      criterio: "similaridade_objeto",
      confianca: score,
      observacao:
        "Objeto do empenho e da emenda sao semelhantes, mas exigem conferencia.",
    };
  }

  return null;
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = uniqueUsefulTokens(left);
  const rightTokens = uniqueUsefulTokens(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  return intersection / Math.max(leftTokens.length, 1);
}

function uniqueUsefulTokens(value: string) {
  const stop = new Set([
    "para",
    "com",
    "dos",
    "das",
    "de",
    "da",
    "do",
    "em",
    "e",
    "a",
    "o",
    "ao",
    "no",
    "na",
    "sec",
    "secretaria",
  ]);

  return Array.from(
    new Set(
      value
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !stop.has(token)),
    ),
  );
}

function valueProximity(expected: number, actual: number) {
  if (!expected || !actual) {
    return 0;
  }

  const diff = Math.abs(expected - actual);
  if (diff <= 1) {
    return 1;
  }

  if (actual > expected * 1.8) {
    return 0.2;
  }

  return Math.max(0, 1 - diff / expected);
}
