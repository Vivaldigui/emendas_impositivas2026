import { emendas } from "@/data/emendas";
import type {
  CriterioVinculo,
  Emenda,
  EmendaEmpenhoVinculo,
  EmpenhoRecord,
} from "@/lib/types";
import { normalizeText } from "@/lib/utils";

export type DeterministicCandidate = {
  empenho: EmpenhoRecord;
  empenhoId: string;
  scoreDeterministico: number;
  criteriosEncontrados: string[];
  divergencias: string[];
};

type ScoreResult = DeterministicCandidate & {
  criterio: CriterioVinculo;
  confianca: number;
  observacao: string;
};

type MatchCandidate = {
  empenho: EmpenhoRecord;
  criterio: CriterioVinculo;
  confianca: number;
  observacao: string;
  scoreDeterministico: number;
  criteriosEncontrados: string[];
  divergencias: string[];
};

const GENERIC_TOKENS = new Set([
  "aquisicao",
  "apoio",
  "compra",
  "contratacao",
  "custeio",
  "despesa",
  "emenda",
  "equipamento",
  "equipamentos",
  "fornecimento",
  "fundacao",
  "fundo",
  "itanhandu",
  "itanhanduense",
  "material",
  "materiais",
  "municipal",
  "municipio",
  "para",
  "prefeitura",
  "projeto",
  "servico",
  "servicos",
  "secretaria",
  "verba",
]);

const GENERIC_CODES = new Set([
  "administracao",
  "assistencia",
  "cultura",
  "educacao",
  "esporte",
  "esportes",
  "fundacao",
  "obras",
  "saude",
  "social",
  "turismo",
]);

const STOP_TOKENS = new Set([
  "a",
  "ao",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "no",
  "o",
  "os",
  "para",
  "por",
]);

const SECRETARIA_EQUIVALENTES: Array<[RegExp, string]> = [
  [/\bsms\b|\bsaude\b|\bsecretaria municipal de saude\b/g, "secretaria saude"],
  [/\bsmds\b|\bassistencia social\b|\bdesenvolvimento social\b/g, "secretaria desenvolvimento social"],
  [/\bsmo\b|\bobras\b|\bsecretaria municipal de obras\b/g, "secretaria obras"],
  [/\bfundacao\b|\besportes?\b|\bcultura\b/g, "fundacao cultura esporte"],
  [/\bturismo\b|\beventos?\b/g, "turismo cultura"],
  [/\beducacao\b|\baabb\b/g, "secretaria educacao"],
  [/\bmeio ambiente\b|\brio verde\b/g, "secretaria meio ambiente"],
  [/\bdesenvolvimento economico\b|\bagricultura\b|\brural\b/g, "secretaria desenvolvimento economico agricultura"],
];

const ENTIDADE_EQUIVALENTES: Array<[RegExp, string]> = [
  [/\bcasa de caridade\b|\bsanta casa\b|\bhospital\b|\brubens nilo\b/g, "casa caridade santa hospital rubens nilo"],
  [/\blar dos idosos\b|\basilo\b/g, "lar idosos"],
  [/\bapae\b/g, "apae"],
  [/\bapaam\b/g, "apaam protecao animal"],
  [/\baabb\b/g, "aabb comunidade"],
  [/\bcasa sarah\b|\bsarah guedes\b/g, "casa sarah guedes"],
  [/\binstituto superacao\b/g, "instituto superacao"],
  [/\bsindicato rural\b/g, "sindicato rural"],
];

const TRANSFERENCIA_TOKENS = [
  "3 3 50 41",
  "335041",
  "3 3 50 43",
  "335043",
  "subvencao",
  "subvencoes",
  "contribuicao",
  "contribuicoes",
  "termo fomento",
  "termo colaboracao",
  "convenio",
  "repasse",
  "transferencia",
];

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
        origem: "REGRA",
        decisao: match.criterio === "conferir" ? "CONFERIR" : "SUGERIDO",
        criterios: match.criteriosEncontrados,
        divergencias: match.divergencias,
        scoreDeterministico: match.scoreDeterministico,
      });
    }
  }

  return vinculos;
}

export function matchEmpenhosForEmenda(
  emenda: Emenda,
  empenhos: EmpenhoRecord[],
): MatchCandidate[] {
  const candidates = gerarCandidatosDeterministicos(emenda, empenhos, 5)
    .map(toMatchCandidate)
    .filter((candidate) => candidate.confianca >= 0.34);

  if (!candidates.length) {
    return [];
  }

  const best = candidates[0];
  const close = candidates.filter(
    (candidate) =>
      candidate.empenho.id !== best.empenho.id &&
      best.confianca - candidate.confianca <= 0.1,
  );

  if (close.length || best.divergencias.length || best.confianca < 0.68) {
    return [
      {
        ...best,
        criterio: "conferir",
        confianca: Math.min(best.confianca, 0.82),
        observacao:
          close.length > 0
            ? "Mais de um empenho ficou proximo. Conferencia manual recomendada."
            : "Ha evidencias de vinculo, mas existem divergencias ou dados insuficientes.",
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

export function gerarCandidatosDeterministicos(
  emenda: Emenda,
  empenhos: EmpenhoRecord[],
  maxCandidates = 5,
): DeterministicCandidate[] {
  return empenhos
    .map((empenho) => scoreEmpenho(emenda, empenho))
    .filter((candidate): candidate is ScoreResult => Boolean(candidate))
    .sort((left, right) => right.scoreDeterministico - left.scoreDeterministico)
    .slice(0, maxCandidates)
    .map(({ criterio: _criterio, confianca: _confianca, observacao: _observacao, ...candidate }) => candidate);
}

function scoreEmpenho(emenda: Emenda, empenho: EmpenhoRecord): ScoreResult | null {
  const emendaText = expandEquivalences(
    normalizeText(
      [
        emenda.descricao,
        emenda.area,
        emenda.secretaria,
        emenda.codigo,
        emenda.acao,
        emenda.dotacao,
      ].join(" "),
    ),
  );
  const empenhoText = expandEquivalences(
    normalizeText(
      [
        empenho.historico,
        empenho.secretaria,
        empenho.unidadeOrcamentaria,
        empenho.fornecedor,
        empenho.cnpjCpfFornecedor,
        empenho.dotacao,
        empenho.naturezaDespesa,
        empenho.modalidadeAplicacao,
        empenho.fonteRecurso,
        empenho.ficha,
        empenho.processoCompra,
        rawText(empenho.linhaBruta),
      ].join(" "),
    ),
  );
  const dotacaoText = expandEquivalences(normalizeText(empenho.dotacao));
  const fornecedorText = expandEquivalences(normalizeText(empenho.fornecedor));
  const secretariaEmenda = expandEquivalences(normalizeText(emenda.secretaria));
  const secretariaEmpenho = expandEquivalences(
    normalizeText([empenho.secretaria, empenho.unidadeOrcamentaria].join(" ")),
  );
  const codigo = expandEquivalences(normalizeText(emenda.codigo));
  const acao = normalizeText(emenda.acao);
  const natureza = normalizeText([empenho.naturezaDespesa, empenho.dotacao, empenho.linhaBruta?.natureza].join(" "));
  const modalidade = normalizeText([empenho.modalidadeAplicacao, empenho.dotacao, rawText(empenho.linhaBruta)].join(" "));
  const criterios: string[] = [];
  const divergencias: string[] = [];
  let score = 0;
  let nonValueScore = 0;
  let valueOnlyScore = 0;

  if (acao && containsCode(dotacaoText, acao)) {
    score += 0.38;
    nonValueScore += 0.38;
    criterios.push(`acao_orcamentaria:${emenda.acao}`);
  } else if (acao && containsCode(empenhoText, acao)) {
    score += 0.28;
    nonValueScore += 0.28;
    criterios.push(`acao_no_historico:${emenda.acao}`);
  }

  if (emenda.dotacao && normalizeText(emenda.dotacao) && dotacaoText.includes(normalizeText(emenda.dotacao))) {
    score += 0.26;
    nonValueScore += 0.26;
    criterios.push("dotacao_correspondente");
  }

  if (
    isSpecificCode(codigo) &&
    (empenhoText.includes(codigo) || fornecedorText.includes(codigo))
  ) {
    score += 0.3;
    nonValueScore += 0.3;
    criterios.push(`entidade_ou_codigo:${emenda.codigo}`);
  }

  const entityScore = entitySimilarity(emendaText, fornecedorText || empenhoText);
  if (entityScore >= 0.34) {
    const weight = fornecedorText ? 0.26 : 0.2;
    score += weight;
    nonValueScore += weight;
    criterios.push(fornecedorText ? "favorecido_compativel" : "entidade_no_historico");
  }

  const textScore = tokenSimilarity(emendaText, empenhoText);
  if (textScore >= 0.18) {
    const weighted = Math.min(0.22, textScore * 0.38);
    score += weighted;
    nonValueScore += weighted;
    criterios.push("historico_ou_objeto_compativel");
  }

  const secretariaScore = tokenSimilarity(secretariaEmenda, secretariaEmpenho || empenhoText);
  if (secretariaScore >= 0.25 || secretariaContains(secretariaEmenda, secretariaEmpenho)) {
    score += 0.12;
    nonValueScore += 0.12;
    criterios.push("secretaria_ou_orgao_compativel");
  }

  if (isTransferencia(emendaText, empenhoText, natureza, modalidade)) {
    score += 0.1;
    nonValueScore += 0.1;
    criterios.push("execucao_por_transferencia_ou_subvencao");
  } else if (natureza.includes("3 3 90") || natureza.includes("3390") || natureza.includes("4 4 90") || natureza.includes("4490")) {
    score += 0.05;
    nonValueScore += 0.05;
    criterios.push("execucao_direta_municipio");
  }

  const valueScore = valueProximity(emenda.valorAutorizado, empenho.valorEmpenhado);
  if (valueScore >= 0.98) {
    valueOnlyScore = 0.08;
    criterios.push("valor_exato");
  } else if (valueScore >= 0.45) {
    valueOnlyScore = 0.05;
    criterios.push("valor_aproximado_ou_execucao_parcial");
  } else if (empenho.valorEmpenhado > emenda.valorAutorizado * 1.15 && nonValueScore >= 0.28) {
    valueOnlyScore = 0.03;
    criterios.push("empenho_pode_reunir_multiplas_emendas");
  }

  if (nonValueScore >= 0.16) {
    score += valueOnlyScore;
  }

  if (empenho.ano && empenho.ano !== 2026) {
    divergencias.push(`ano_empenho:${empenho.ano}`);
    score -= 0.08;
  }

  if (valueScore < 0.18 && empenho.valorEmpenhado > 0 && nonValueScore < 0.32) {
    divergencias.push("valor_distante_sem_evidencia_forte");
  }

  const hasStrongEvidence = criterios.some((criterio) =>
    criterio.startsWith("acao_") ||
    criterio === "dotacao_correspondente" ||
    criterio.startsWith("entidade_ou_codigo") ||
    criterio === "favorecido_compativel" ||
    criterio === "entidade_no_historico",
  );
  const hasSpecificObjectEvidence =
    criterios.includes("historico_ou_objeto_compativel") && textScore >= 0.34;

  if (!hasStrongEvidence && !hasSpecificObjectEvidence) {
    return null;
  }

  if (nonValueScore < 0.22 || score < 0.3) {
    return null;
  }

  const normalizedScore = Math.max(0, Math.min(0.99, Number(score.toFixed(4))));

  return {
    empenho,
    empenhoId: empenho.id,
    scoreDeterministico: normalizedScore,
    criteriosEncontrados: Array.from(new Set(criterios)),
    divergencias: Array.from(new Set(divergencias)),
    criterio: primaryCriterio(criterios, divergencias, normalizedScore),
    confianca: normalizedScore,
    observacao: buildObservacao(criterios, divergencias),
  };
}

function toMatchCandidate(candidate: DeterministicCandidate): MatchCandidate {
  const criterio = primaryCriterio(
    candidate.criteriosEncontrados,
    candidate.divergencias,
    candidate.scoreDeterministico,
  );

  return {
    empenho: candidate.empenho,
    criterio,
    confianca: candidate.scoreDeterministico,
    observacao: buildObservacao(candidate.criteriosEncontrados, candidate.divergencias),
    scoreDeterministico: candidate.scoreDeterministico,
    criteriosEncontrados: candidate.criteriosEncontrados,
    divergencias: candidate.divergencias,
  };
}

function primaryCriterio(
  criterios: string[],
  divergencias: string[],
  score: number,
): CriterioVinculo {
  if (divergencias.length || score < 0.58) {
    return "conferir";
  }

  if (criterios.some((criterio) => criterio.startsWith("acao_") || criterio === "dotacao_correspondente")) {
    return "acao_dotacao";
  }

  if (criterios.some((criterio) => criterio.startsWith("entidade_ou_codigo") || criterio === "favorecido_compativel")) {
    return "codigo_secretaria";
  }

  if (criterios.includes("historico_ou_objeto_compativel") || criterios.includes("secretaria_ou_orgao_compativel")) {
    return "historico_secretaria";
  }

  return "similaridade_objeto";
}

function buildObservacao(criterios: string[], divergencias: string[]) {
  if (divergencias.length) {
    return `Evidencias encontradas (${criterios.join(", ")}), mas ha divergencias: ${divergencias.join(", ")}.`;
  }

  return criterios.length
    ? `Evidencias encontradas: ${criterios.join(", ")}.`
    : "Candidato gerado por pontuacao deterministica.";
}

function expandEquivalences(value: string) {
  let expanded = value;

  for (const [pattern, replacement] of [...SECRETARIA_EQUIVALENTES, ...ENTIDADE_EQUIVALENTES]) {
    expanded = expanded.replace(pattern, `${replacement} `);
  }

  return expanded.replace(/\s+/g, " ").trim();
}

function containsCode(haystack: string, code: string) {
  const normalizedCode = normalizeText(code);
  const compactHaystack = haystack.replace(/\s/g, "");
  const compactCode = normalizedCode.replace(/\s/g, "");

  return Boolean(
    normalizedCode &&
      (haystack.includes(normalizedCode) || compactHaystack.includes(compactCode)),
  );
}

function isSpecificCode(code: string) {
  const tokens = usefulTokens(code);

  if (!tokens.length) {
    return false;
  }

  return tokens.some((token) => !GENERIC_CODES.has(token) && !GENERIC_TOKENS.has(token));
}

function secretaryTokens(value: string) {
  return usefulTokens(value).filter((token) => !GENERIC_TOKENS.has(token));
}

function secretariaContains(left: string, right: string) {
  const leftTokens = secretaryTokens(left);
  const rightTokens = new Set(secretaryTokens(right));
  return leftTokens.some((token) => rightTokens.has(token));
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = usefulTokens(left).filter((token) => !GENERIC_TOKENS.has(token));
  const rightTokens = usefulTokens(right).filter((token) => !GENERIC_TOKENS.has(token));

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  return intersection / Math.max(leftTokens.length, 1);
}

function entitySimilarity(left: string, right: string) {
  const entityTokens = usefulTokens(left).filter(
    (token) => !GENERIC_TOKENS.has(token) && token.length >= 4,
  );
  const rightTokens = new Set(usefulTokens(right));

  if (!entityTokens.length || !rightTokens.size) {
    return 0;
  }

  const hits = entityTokens.filter((token) => rightTokens.has(token)).length;
  return hits / entityTokens.length;
}

function usefulTokens(value: string) {
  return Array.from(
    new Set(
      value
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_TOKENS.has(token)),
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
    return 0.25;
  }

  if (actual < expected && actual >= expected * 0.15) {
    return Math.max(0.45, 1 - diff / expected);
  }

  return Math.max(0, 1 - diff / expected);
}

function isTransferencia(
  emendaText: string,
  empenhoText: string,
  natureza: string,
  modalidade: string,
) {
  const joined = `${emendaText} ${empenhoText} ${natureza} ${modalidade}`;

  return TRANSFERENCIA_TOKENS.some((token) => joined.includes(token));
}

function rawText(value: Record<string, unknown> | undefined) {
  if (!value) {
    return "";
  }

  return Object.values(value)
    .map((item) => String(item ?? ""))
    .join(" ");
}
