import crypto from "node:crypto";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { Prisma } from "../../generated/prisma/client";
import { getEmendas, getVereadores } from "@/services/emendasRepository";
import type {
  AnaliseIaResumo,
  DecisaoVinculo,
  Emenda,
  EmendaEmpenhoVinculo,
  EmpenhoRecord,
  OrigemVinculo,
  ResultadoAnaliseIa,
} from "@/lib/types";
import { normalizeText } from "@/lib/utils";
import {
  DeterministicCandidate,
  gerarCandidatosDeterministicos,
} from "@/services/emendaMatcher";
import { loadAllEmpenhos } from "@/services/empenhosStorage";
import { prisma } from "../../lib/prisma";

export const AI_PROMPT_VERSION = "empenho-linker-v1";
const MANDATORY_PROMPT_RULE =
  "Não invente vínculos financeiros. Analise somente os empenhos candidatos fornecidos. Quando houver qualquer dúvida relevante, retorne CONFERIR. Quando nenhum candidato apresentar evidências suficientes, retorne SEM_VINCULO. Nunca trate semelhança de valor, isoladamente, como prova de vínculo.";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_CANDIDATES = 5;
const DEFAULT_CONCURRENCY = 2;
const OPENAI_TIMEOUT_MS = 25_000;
const OPENAI_MAX_RETRIES = 1;

const AiEmpenhoLinkResultSchema = z.object({
  emendaId: z.string(),
  decisaoGeral: z.enum(["SUGERIR_VINCULOS", "CONFERIR", "SEM_VINCULO"]),
  confiancaGeral: z.number().min(0).max(1),
  vinculos: z.array(
    z.object({
      empenhoId: z.string(),
      valorAtribuido: z.number().nonnegative().nullable(),
      confianca: z.number().min(0).max(1),
      criterios: z.array(z.string()),
      divergencias: z.array(z.string()),
      justificativaCurta: z.string(),
      camposUsados: z.array(z.string()),
    }),
  ),
  justificativaGeral: z.string(),
  alertas: z.array(z.string()),
});

export type AiEmpenhoLinkResult = z.infer<typeof AiEmpenhoLinkResultSchema>;

export type AnalyzeBatchOptions = {
  emendaIds?: string[];
  reanalisar?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  openAiClient?: Pick<OpenAI, "responses">;
};

export type AnalyzeOneResult = {
  emendaId: string;
  status: "SUGERIDO" | "CONFERIR" | "SEM_VINCULO" | "REAPROVEITADO" | "ERRO";
  inputHash: string | null;
  candidatos: number;
  vinculos: Array<EmendaEmpenhoVinculo & { empenho?: EmpenhoRecord }>;
  analise: AnaliseIaResumo | null;
  erro?: string;
  iaDisponivel: boolean;
};

export type AnalyzeBatchResult = {
  ok: boolean;
  dryRun: boolean;
  iaDisponivel: boolean;
  resumo: {
    analisadas: number;
    sugeridas: number;
    conferir: number;
    semVinculo: number;
    reaproveitadas: number;
    erros: number;
  };
  resultados: AnalyzeOneResult[];
};

export type ReviewAction =
  | "CONFIRMAR"
  | "REJEITAR"
  | "ALTERAR_VALOR"
  | "DESFAZER_CONFIRMACAO";

export type ReviewInput = {
  vinculoId: string;
  acao: ReviewAction;
  valorAtribuido?: number | null;
  justificativa?: string | null;
  permitirExcedente?: boolean;
  revisadoPor: string;
};

export function isOpenAiEmpenhoEnabled() {
  return (
    process.env.OPENAI_EMPENHO_ENABLED !== "false" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

export function getOpenAiEmpenhoModel() {
  return process.env.OPENAI_EMPENHO_MODEL || DEFAULT_MODEL;
}

export async function analisarVinculosEmendas(
  options: AnalyzeBatchOptions = {},
): Promise<AnalyzeBatchResult> {
  const iaDisponivel = isOpenAiEmpenhoEnabled();
  const todasEmendas = await getEmendas();
  const targetEmendas = todasEmendas.filter((emenda) =>
    options.emendaIds?.length ? options.emendaIds.includes(emenda.id) : true,
  );
  const empenhos = await loadEmpenhosForAnalysis();
  const results = await runWithConcurrency(
    targetEmendas,
    Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 4)),
    (emenda) =>
      analisarUmaEmenda(emenda, empenhos, {
        ...options,
        openAiClient: options.openAiClient,
      }),
  );

  return {
    ok: results.every((result) => result.status !== "ERRO"),
    dryRun: options.dryRun === true,
    iaDisponivel,
    resumo: {
      analisadas: results.length,
      sugeridas: results.filter((result) => result.status === "SUGERIDO").length,
      conferir: results.filter((result) => result.status === "CONFERIR").length,
      semVinculo: results.filter((result) => result.status === "SEM_VINCULO").length,
      reaproveitadas: results.filter((result) => result.status === "REAPROVEITADO").length,
      erros: results.filter((result) => result.status === "ERRO").length,
    },
    resultados: results,
  };
}

export async function analisarUmaEmenda(
  emenda: Emenda,
  empenhos: EmpenhoRecord[],
  options: AnalyzeBatchOptions = {},
): Promise<AnalyzeOneResult> {
  const candidatos = gerarCandidatosDeterministicos(emenda, empenhos, MAX_CANDIDATES);
  const vereadores = await getVereadores();
  const vereadorNome = vereadores.find((item) => item.id === emenda.vereadorId)?.nome;
  const payload = buildAiPayload(emenda, candidatos, vereadorNome);
  const inputHash = hashPayload(payload);
  const model = getOpenAiEmpenhoModel();
  const iaDisponivel = isOpenAiEmpenhoEnabled();

  try {
    const existing = await prisma.analiseIaEmenda.findUnique({
      where: { emendaId_inputHash: { emendaId: emenda.id, inputHash } },
    });

    if (existing && options.reanalisar !== true) {
      return {
        emendaId: emenda.id,
        status: "REAPROVEITADO",
        inputHash,
        candidatos: candidatos.length,
        vinculos: [],
        analise: toAnaliseResumo(existing),
        iaDisponivel,
      };
    }

    if (!candidatos.length) {
      const analise = buildAnaliseResumo({
        id: "dry-run",
        emendaId: emenda.id,
        resultadoGeral: "SEM_VINCULO",
        dataAnalise: new Date(),
        modelo: iaDisponivel ? model : null,
        promptVersion: AI_PROMPT_VERSION,
        inputHash,
        quantidadeCandidatos: 0,
        justificativa: "Nenhum empenho candidato foi localizado pelas regras deterministicas.",
        erro: null,
      });

      if (!options.dryRun) {
        const saved = await persistAnalise({
          emendaId: emenda.id,
          resultadoGeral: "SEM_VINCULO",
          modelo: iaDisponivel ? model : null,
          inputHash,
          quantidadeCandidatos: 0,
          justificativa: analise.justificativa,
          erro: null,
        });
        return {
          emendaId: emenda.id,
          status: "SEM_VINCULO",
          inputHash,
          candidatos: 0,
          vinculos: [],
          analise: toAnaliseResumo(saved),
          iaDisponivel,
        };
      }

      return {
        emendaId: emenda.id,
        status: "SEM_VINCULO",
        inputHash,
        candidatos: 0,
        vinculos: [],
        analise,
        iaDisponivel,
      };
    }

    const aiResult = iaDisponivel
      ? await callOpenAiForEmenda(payload, options.openAiClient)
      : fallbackDeterministico(emenda.id, candidatos);
    const sanitized = validateAiResult(aiResult, emenda, candidatos);

    if (options.dryRun) {
      return {
        emendaId: emenda.id,
        status: statusFromAi(sanitized),
        inputHash,
        candidatos: candidatos.length,
        vinculos: sanitized.vinculos.map((vinculo) =>
          toUiVinculo(emenda.id, vinculo, candidatos, iaDisponivel ? "IA" : "REGRA", model, inputHash),
        ),
        analise: buildAnaliseResumo({
          id: "dry-run",
          emendaId: emenda.id,
          resultadoGeral: sanitized.decisaoGeral,
          dataAnalise: new Date(),
          modelo: iaDisponivel ? model : null,
          promptVersion: AI_PROMPT_VERSION,
          inputHash,
          quantidadeCandidatos: candidatos.length,
          justificativa: sanitized.justificativaGeral,
          erro: null,
        }),
        iaDisponivel,
      };
    }

    const analise = await persistAnalise({
      emendaId: emenda.id,
      resultadoGeral: sanitized.decisaoGeral,
      modelo: iaDisponivel ? model : null,
      inputHash,
      quantidadeCandidatos: candidatos.length,
      justificativa: sanitized.justificativaGeral,
      erro: null,
    });
    const persisted = await persistVinculosFromAnalysis({
      emenda,
      candidatos,
      result: sanitized,
      origem: iaDisponivel ? "IA" : "REGRA",
      model: iaDisponivel ? model : null,
      inputHash,
    });

    return {
      emendaId: emenda.id,
      status: statusFromAi(sanitized),
      inputHash,
      candidatos: candidatos.length,
      vinculos: persisted,
      analise: toAnaliseResumo(analise),
      iaDisponivel,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido na analise.";

    if (!options.dryRun) {
      await persistAnalise({
        emendaId: emenda.id,
        resultadoGeral: "ERRO",
        modelo: iaDisponivel ? model : null,
        inputHash,
        quantidadeCandidatos: candidatos.length,
        justificativa: null,
        erro: message,
      }).catch(() => null);
    }

    return {
      emendaId: emenda.id,
      status: "ERRO",
      inputHash,
      candidatos: candidatos.length,
      vinculos: [],
      analise: null,
      erro: message,
      iaDisponivel,
    };
  }
}

export function validateAiResult(
  result: AiEmpenhoLinkResult,
  emenda: Emenda,
  candidatos: DeterministicCandidate[],
) {
  const parsed = AiEmpenhoLinkResultSchema.parse(result);

  if (parsed.emendaId !== emenda.id) {
    throw new Error(`IA retornou emendaId divergente: ${parsed.emendaId}.`);
  }

  const candidateIds = new Set(candidatos.map((candidate) => candidate.empenhoId));

  for (const vinculo of parsed.vinculos) {
    if (!candidateIds.has(vinculo.empenhoId)) {
      throw new Error(`IA retornou empenhoId fora dos candidatos: ${vinculo.empenhoId}.`);
    }
  }

  if (parsed.decisaoGeral === "SEM_VINCULO" && parsed.vinculos.length > 0) {
    throw new Error("IA retornou SEM_VINCULO com lista de vinculos.");
  }

  return parsed;
}

export async function loadPersistedLinkState() {
  const [vinculos, analises, dbEmpenhos] = await Promise.all([
    prisma.emendaEmpenhoVinculo.findMany({
      include: { empenho: true },
      orderBy: { atualizadoEm: "desc" },
    }),
    prisma.analiseIaEmenda.findMany({
      orderBy: { dataAnalise: "desc" },
    }),
    prisma.empenho.findMany(),
  ]);

  const empenhos = dbEmpenhos.map(dbEmpenhoToRecord);
  const vinculosByEmenda = new Map<string, Array<EmendaEmpenhoVinculo & { empenho: EmpenhoRecord }>>();
  const analiseByEmenda = new Map<string, AnaliseIaResumo>();

  for (const analise of analises) {
    if (!analiseByEmenda.has(analise.emendaId)) {
      analiseByEmenda.set(analise.emendaId, toAnaliseResumo(analise));
    }
  }

  for (const vinculo of vinculos) {
    const ui = dbVinculoToUi(vinculo, dbEmpenhoToRecord(vinculo.empenho));
    const current = vinculosByEmenda.get(vinculo.emendaId) ?? [];
    current.push(ui);
    vinculosByEmenda.set(vinculo.emendaId, current);
  }

  return { vinculosByEmenda, analiseByEmenda, empenhos };
}

export async function revisarVinculo(input: ReviewInput) {
  const vinculo = await prisma.emendaEmpenhoVinculo.findUnique({
    where: { id: input.vinculoId },
    include: { emenda: true, empenho: true },
  });

  if (!vinculo) {
    throw new Error("Vinculo nao localizado.");
  }

  const previousDecision = vinculo.decisao;
  const previousValue = decimalToNumber(vinculo.valorAtribuido);
  const nextDecision = nextDecisionForAction(input.acao, previousDecision);
  const nextValue =
    input.acao === "ALTERAR_VALOR" || input.valorAtribuido !== undefined
      ? normalizeValorAtribuido(input.valorAtribuido)
      : previousValue;

  if (input.acao === "REJEITAR" && !input.justificativa?.trim()) {
    throw new Error("Justificativa obrigatoria para rejeitar sugestao.");
  }

  if (input.acao === "DESFAZER_CONFIRMACAO" && !input.justificativa?.trim()) {
    throw new Error("Justificativa obrigatoria para desfazer confirmacao.");
  }

  if ((nextDecision === "CONFIRMADO" || input.acao === "ALTERAR_VALOR") && nextValue !== null) {
    await validateAssignedValueLimits({
      emendaId: vinculo.emendaId,
      empenhoId: vinculo.empenhoId,
      vinculoId: vinculo.id,
      valorAtribuido: nextValue,
      valorEmenda: decimalToNumber(vinculo.emenda.valorAutorizado) ?? 0,
      valorEmpenho: decimalToNumber(vinculo.empenho.valorEmpenhado) ?? 0,
      permitirExcedente: input.permitirExcedente === true,
      justificativa: input.justificativa,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.emendaEmpenhoVinculo.update({
      where: { id: vinculo.id },
      data: {
        decisao: nextDecision,
        valorAtribuido: nextValue,
        revisadoEm: new Date(),
        revisadoPor: input.revisadoPor,
      },
      include: { empenho: true },
    });

    await tx.emendaEmpenhoRevisao.create({
      data: {
        vinculoId: vinculo.id,
        emendaId: vinculo.emendaId,
        empenhoId: vinculo.empenhoId,
        situacaoAnterior: previousDecision,
        situacaoNova: nextDecision,
        valorAnterior: previousValue,
        valorNovo: nextValue,
        justificativa: input.justificativa ?? null,
        revisadoPor: input.revisadoPor,
      },
    });

    return saved;
  });

  return dbVinculoToUi(updated, dbEmpenhoToRecord(updated.empenho));
}

export async function getHistoricoRevisoes(filters: { emendaId?: string; vinculoId?: string }) {
  const [analises, revisoes] = await Promise.all([
    prisma.analiseIaEmenda.findMany({
      where: filters.emendaId ? { emendaId: filters.emendaId } : undefined,
      orderBy: { dataAnalise: "desc" },
      take: 100,
    }),
    prisma.emendaEmpenhoRevisao.findMany({
      where: {
        ...(filters.emendaId ? { emendaId: filters.emendaId } : {}),
        ...(filters.vinculoId ? { vinculoId: filters.vinculoId } : {}),
      },
      orderBy: { revisadoEm: "desc" },
      take: 100,
    }),
  ]);

  return {
    analises: analises.map(toAnaliseResumo),
    revisoes: revisoes.map((revisao) => ({
      id: revisao.id,
      vinculoId: revisao.vinculoId,
      emendaId: revisao.emendaId,
      empenhoId: revisao.empenhoId,
      situacaoAnterior: revisao.situacaoAnterior,
      situacaoNova: revisao.situacaoNova,
      valorAnterior: decimalToNumber(revisao.valorAnterior),
      valorNovo: decimalToNumber(revisao.valorNovo),
      justificativa: revisao.justificativa,
      revisadoPor: revisao.revisadoPor,
      revisadoEm: revisao.revisadoEm.toISOString(),
    })),
  };
}

async function callOpenAiForEmenda(
  payload: ReturnType<typeof buildAiPayload>,
  injectedClient?: Pick<OpenAI, "responses">,
) {
  const client = injectedClient ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = getOpenAiEmpenhoModel();
  const response = await retryTemporary(
    () =>
      client.responses.parse(
        {
          model,
          instructions: buildSystemPrompt(),
          input: JSON.stringify(payload),
          text: {
            format: zodTextFormat(AiEmpenhoLinkResultSchema, "empenho_link_result"),
          },
        },
        { timeout: OPENAI_TIMEOUT_MS },
      ),
    OPENAI_MAX_RETRIES,
  );

  if (!response.output_parsed) {
    throw new Error("Resposta da IA nao contem resultado estruturado.");
  }

  return response.output_parsed;
}

function buildSystemPrompt() {
  return [
    "Voce analisa possiveis vinculos entre emendas impositivas e empenhos publicos.",
    MANDATORY_PROMPT_RULE,
    "Voce nunca confirma definitivamente um vinculo. Mesmo com confianca alta, retorne apenas sugestoes para revisao humana.",
    "Considere execucao direta, obra, compra, servico, material de consumo, equipamento permanente, transferencia, subvencao social, contribuicao, termo de fomento, termo de colaboracao, convenio, repasse, custeio de entidade, Fundacao e Fundo Municipal.",
    "Avalie compatibilidade de objeto, entidade/favorecido, CNPJ/CPF quando fornecido, acao, dotacao, secretaria, natureza da despesa, modalidade, fonte, valores parciais e empenhos globais.",
    "Retorne sempre o schema estruturado solicitado.",
  ].join("\n");
}

function fallbackDeterministico(
  emendaId: string,
  candidatos: DeterministicCandidate[],
): AiEmpenhoLinkResult {
  if (!candidatos.length) {
    return {
      emendaId,
      decisaoGeral: "SEM_VINCULO",
      confiancaGeral: 0,
      vinculos: [],
      justificativaGeral: "Analise por IA indisponivel e nenhum candidato deterministico localizado.",
      alertas: ["Analise de IA indisponivel."],
    };
  }

  const top = candidatos.slice(0, 3);
  const highConfidence = top[0]?.scoreDeterministico >= 0.72 && !top[0].divergencias.length;

  return {
    emendaId,
    decisaoGeral: highConfidence ? "SUGERIR_VINCULOS" : "CONFERIR",
    confiancaGeral: top[0]?.scoreDeterministico ?? 0,
    vinculos: top.map((candidate) => ({
      empenhoId: candidate.empenhoId,
      valorAtribuido: null,
      confianca: candidate.scoreDeterministico,
      criterios: candidate.criteriosEncontrados,
      divergencias: candidate.divergencias,
      justificativaCurta:
        "Candidato gerado por regras deterministicas; IA indisponivel para analise complementar.",
      camposUsados: ["regra_deterministica", "historico", "dotacao", "secretaria", "valor"],
    })),
    justificativaGeral:
      "Analise por IA indisponivel. Foram preservados candidatos deterministicos para conferencia manual.",
    alertas: ["Analise de IA indisponivel."],
  };
}

function buildAiPayload(
  emenda: Emenda,
  candidatos: DeterministicCandidate[],
  vereadorNome?: string,
) {
  return {
    promptVersion: AI_PROMPT_VERSION,
    regraObrigatoria: MANDATORY_PROMPT_RULE,
    emenda: {
      id: emenda.id,
      vereador: vereadorNome ?? emenda.vereadorId,
      descricao: emenda.descricao,
      valorAutorizado: emenda.valorAutorizado,
      area: emenda.area,
      secretaria: emenda.secretaria,
      codigo: emenda.codigo,
      acao: emenda.acao,
      dotacao: emenda.dotacao,
    },
    candidatos: candidatos.map((candidate) => ({
      empenhoId: candidate.empenhoId,
      scoreDeterministico: candidate.scoreDeterministico,
      criteriosEncontrados: candidate.criteriosEncontrados,
      divergencias: candidate.divergencias,
      empenho: essentialEmpenho(candidate.empenho),
    })),
  };
}

function essentialEmpenho(empenho: EmpenhoRecord) {
  return {
    id: empenho.id,
    ano: empenho.ano,
    numeroEmpenho: empenho.numeroEmpenho,
    dataEmpenho: empenho.dataEmpenho,
    fornecedor: empenho.fornecedor,
    cnpjCpfFornecedor: empenho.cnpjCpfFornecedor ? maskCpfCnpj(empenho.cnpjCpfFornecedor) : null,
    historico: empenho.historico,
    secretaria: empenho.secretaria,
    unidadeOrcamentaria: empenho.unidadeOrcamentaria,
    dotacao: empenho.dotacao,
    naturezaDespesa: empenho.naturezaDespesa,
    modalidadeAplicacao: empenho.modalidadeAplicacao,
    fonteRecurso: empenho.fonteRecurso,
    ficha: empenho.ficha,
    processoCompra: empenho.processoCompra,
    valorEmpenhado: empenho.valorEmpenhado,
    valorLiquidado: empenho.valorLiquidado,
    valorPago: empenho.valorPago,
    situacao: empenho.situacao,
  };
}

function hashPayload(payload: unknown) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function persistAnalise(input: {
  emendaId: string;
  resultadoGeral: ResultadoAnaliseIa;
  modelo: string | null;
  inputHash: string;
  quantidadeCandidatos: number;
  justificativa: string | null;
  erro: string | null;
}) {
  return prisma.analiseIaEmenda.upsert({
    where: { emendaId_inputHash: { emendaId: input.emendaId, inputHash: input.inputHash } },
    create: {
      emendaId: input.emendaId,
      resultadoGeral: input.resultadoGeral,
      modelo: input.modelo,
      promptVersion: AI_PROMPT_VERSION,
      inputHash: input.inputHash,
      quantidadeCandidatos: input.quantidadeCandidatos,
      justificativa: input.justificativa,
      erro: input.erro,
    },
    update: {
      resultadoGeral: input.resultadoGeral,
      modelo: input.modelo,
      promptVersion: AI_PROMPT_VERSION,
      quantidadeCandidatos: input.quantidadeCandidatos,
      justificativa: input.justificativa,
      erro: input.erro,
    },
  });
}

async function persistVinculosFromAnalysis(input: {
  emenda: Emenda;
  candidatos: DeterministicCandidate[];
  result: AiEmpenhoLinkResult;
  origem: OrigemVinculo;
  model: string | null;
  inputHash: string;
}) {
  if (input.result.decisaoGeral === "SEM_VINCULO") {
    return [];
  }

  const byEmpenho = new Map(input.candidatos.map((candidate) => [candidate.empenhoId, candidate]));
  const persisted: Array<EmendaEmpenhoVinculo & { empenho: EmpenhoRecord }> = [];

  for (const vinculo of input.result.vinculos) {
    const candidate = byEmpenho.get(vinculo.empenhoId);
    if (!candidate) {
      continue;
    }

    await upsertEmpenho(candidate.empenho);

    const existing = await prisma.emendaEmpenhoVinculo.findUnique({
      where: {
        emendaId_empenhoId: {
          emendaId: input.emenda.id,
          empenhoId: vinculo.empenhoId,
        },
      },
    });

    if (existing?.decisao === "CONFIRMADO" || existing?.decisao === "REJEITADO") {
      continue;
    }

    const assignedValue = safeAssignedValue(
      vinculo.valorAtribuido,
      input.emenda.valorAutorizado,
      candidate.empenho.valorEmpenhado,
    );
    const decisao: DecisaoVinculo =
      input.result.decisaoGeral === "CONFERIR" || vinculo.divergencias.length
        ? "CONFERIR"
        : "SUGERIDO";

    const saved = await prisma.emendaEmpenhoVinculo.upsert({
      where: {
        emendaId_empenhoId: {
          emendaId: input.emenda.id,
          empenhoId: vinculo.empenhoId,
        },
      },
      create: {
        emendaId: input.emenda.id,
        empenhoId: vinculo.empenhoId,
        criterio: primaryCriterio(candidate),
        confianca: vinculo.confianca,
        observacao: vinculo.justificativaCurta,
        valorAtribuido: assignedValue,
        origem: input.origem,
        decisao,
        criterios: mergeStrings(candidate.criteriosEncontrados, vinculo.criterios),
        justificativaCurta: vinculo.justificativaCurta,
        camposUsados: vinculo.camposUsados,
        modelo: input.model,
        promptVersion: AI_PROMPT_VERSION,
        inputHash: input.inputHash,
      },
      update: {
        criterio: primaryCriterio(candidate),
        confianca: vinculo.confianca,
        observacao: vinculo.justificativaCurta,
        valorAtribuido: assignedValue,
        origem: input.origem,
        decisao,
        criterios: mergeStrings(candidate.criteriosEncontrados, vinculo.criterios),
        justificativaCurta: vinculo.justificativaCurta,
        camposUsados: vinculo.camposUsados,
        modelo: input.model,
        promptVersion: AI_PROMPT_VERSION,
        inputHash: input.inputHash,
      },
      include: { empenho: true },
    });

    persisted.push(dbVinculoToUi(saved, dbEmpenhoToRecord(saved.empenho)));
  }

  return persisted;
}

async function upsertEmpenho(empenho: EmpenhoRecord) {
  await prisma.empenho.upsert({
    where: { id: empenho.id },
    create: {
      id: empenho.id,
      ano: empenho.ano,
      numeroEmpenho: empenho.numeroEmpenho,
      dataEmpenho: empenho.dataEmpenho ? new Date(empenho.dataEmpenho) : null,
      fornecedor: empenho.fornecedor,
      cnpjCpfFornecedor: empenho.cnpjCpfFornecedor ?? null,
      historico: empenho.historico,
      secretaria: empenho.secretaria,
      dotacao: empenho.dotacao,
      ficha: empenho.ficha,
      processoCompra: empenho.processoCompra,
      valorEmpenhado: empenho.valorEmpenhado,
      valorLiquidado: empenho.valorLiquidado,
      valorPago: empenho.valorPago,
      situacao: empenho.situacao,
      fonte: empenho.fonte,
      hashArquivo: empenho.hashArquivo ?? null,
      linhaBruta: jsonOrUndefined(empenho.linhaBruta),
    },
    update: {
      ano: empenho.ano,
      numeroEmpenho: empenho.numeroEmpenho,
      dataEmpenho: empenho.dataEmpenho ? new Date(empenho.dataEmpenho) : null,
      fornecedor: empenho.fornecedor,
      cnpjCpfFornecedor: empenho.cnpjCpfFornecedor ?? null,
      historico: empenho.historico,
      secretaria: empenho.secretaria,
      dotacao: empenho.dotacao,
      ficha: empenho.ficha,
      processoCompra: empenho.processoCompra,
      valorEmpenhado: empenho.valorEmpenhado,
      valorLiquidado: empenho.valorLiquidado,
      valorPago: empenho.valorPago,
      situacao: empenho.situacao,
      fonte: empenho.fonte,
      hashArquivo: empenho.hashArquivo ?? null,
      linhaBruta: jsonOrUndefined(empenho.linhaBruta),
    },
  });
}

async function loadEmpenhosForAnalysis() {
  const [stored, persisted] = await Promise.all([
    loadAllEmpenhos(),
    prisma.empenho.findMany().catch(() => []),
  ]);
  const byId = new Map<string, EmpenhoRecord>();

  for (const empenho of persisted.map(dbEmpenhoToRecord)) {
    byId.set(empenho.id, empenho);
  }

  for (const empenho of stored) {
    byId.set(empenho.id, empenho);
  }

  return Array.from(byId.values());
}

async function validateAssignedValueLimits(input: {
  emendaId: string;
  empenhoId: string;
  vinculoId: string;
  valorAtribuido: number;
  valorEmenda: number;
  valorEmpenho: number;
  permitirExcedente: boolean;
  justificativa?: string | null;
}) {
  if (input.valorAtribuido < 0) {
    throw new Error("Valor atribuido nao pode ser negativo.");
  }

  const [emendaLinks, empenhoLinks] = await Promise.all([
    prisma.emendaEmpenhoVinculo.findMany({
      where: {
        emendaId: input.emendaId,
        id: { not: input.vinculoId },
        decisao: { not: "REJEITADO" },
      },
    }),
    prisma.emendaEmpenhoVinculo.findMany({
      where: {
        empenhoId: input.empenhoId,
        id: { not: input.vinculoId },
        decisao: { not: "REJEITADO" },
      },
    }),
  ]);
  const totalEmenda =
    input.valorAtribuido +
    emendaLinks.reduce((total, item) => total + (decimalToNumber(item.valorAtribuido) ?? 0), 0);
  const totalEmpenho =
    input.valorAtribuido +
    empenhoLinks.reduce((total, item) => total + (decimalToNumber(item.valorAtribuido) ?? 0), 0);
  const exceedsEmenda = input.valorEmenda > 0 && totalEmenda > input.valorEmenda + 0.01;
  const exceedsEmpenho = input.valorEmpenho > 0 && totalEmpenho > input.valorEmpenho + 0.01;

  if (!exceedsEmenda && !exceedsEmpenho) {
    return;
  }

  if (input.permitirExcedente && input.justificativa?.trim()) {
    return;
  }

  throw new Error(
    [
      exceedsEmenda ? "Soma atribuida ultrapassa o valor autorizado da emenda." : null,
      exceedsEmpenho ? "Soma atribuida ultrapassa o valor do empenho." : null,
      "Informe justificativa e permitirExcedente=true para registrar autorizacao manual.",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function safeAssignedValue(
  value: number | null,
  valorEmenda: number,
  valorEmpenho: number,
) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value < 0 || value > Math.max(valorEmenda, valorEmpenho) + 0.01) {
    return null;
  }

  return Number(value.toFixed(2));
}

function normalizeValorAtribuido(value: number | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Valor atribuido invalido.");
  }

  return Number(value.toFixed(2));
}

function nextDecisionForAction(action: ReviewAction, current: string): DecisaoVinculo {
  if (action === "CONFIRMAR") {
    return "CONFIRMADO";
  }

  if (action === "REJEITAR") {
    return "REJEITADO";
  }

  if (action === "ALTERAR_VALOR") {
    return current as DecisaoVinculo;
  }

  return "CONFERIR";
}

function statusFromAi(result: AiEmpenhoLinkResult): AnalyzeOneResult["status"] {
  if (result.decisaoGeral === "SEM_VINCULO") {
    return "SEM_VINCULO";
  }

  return result.decisaoGeral === "CONFERIR" ? "CONFERIR" : "SUGERIDO";
}

function toUiVinculo(
  emendaId: string,
  vinculo: AiEmpenhoLinkResult["vinculos"][number],
  candidatos: DeterministicCandidate[],
  origem: OrigemVinculo,
  model: string | null,
  inputHash: string,
): EmendaEmpenhoVinculo {
  const candidate = candidatos.find((item) => item.empenhoId === vinculo.empenhoId);

  return {
    emendaId,
    empenhoId: vinculo.empenhoId,
    criterio: candidate ? primaryCriterio(candidate) : "conferir",
    confianca: vinculo.confianca,
    observacao: vinculo.justificativaCurta,
    valorAtribuido: vinculo.valorAtribuido,
    origem,
    decisao: vinculo.divergencias.length ? "CONFERIR" : "SUGERIDO",
    criterios: mergeStrings(candidate?.criteriosEncontrados ?? [], vinculo.criterios),
    divergencias: mergeStrings(candidate?.divergencias ?? [], vinculo.divergencias),
    justificativaCurta: vinculo.justificativaCurta,
    camposUsados: vinculo.camposUsados,
    modelo: model,
    promptVersion: AI_PROMPT_VERSION,
    inputHash,
    scoreDeterministico: candidate?.scoreDeterministico,
    empenho: candidate?.empenho,
  } as EmendaEmpenhoVinculo;
}

function dbVinculoToUi(
  vinculo: {
    id: string;
    emendaId: string;
    empenhoId: string;
    criterio: string;
    confianca: unknown;
    observacao: string;
    valorAtribuido: unknown;
    origem: string;
    decisao: string;
    criterios: string[];
    justificativaCurta: string | null;
    camposUsados: string[];
    modelo: string | null;
    promptVersion: string | null;
    inputHash: string | null;
    criadoEm: Date;
    atualizadoEm: Date;
    revisadoEm: Date | null;
    revisadoPor: string | null;
  },
  empenho: EmpenhoRecord,
): EmendaEmpenhoVinculo & { empenho: EmpenhoRecord } {
  return {
    id: vinculo.id,
    emendaId: vinculo.emendaId,
    empenhoId: vinculo.empenhoId,
    criterio: vinculo.criterio as EmendaEmpenhoVinculo["criterio"],
    confianca: decimalToNumber(vinculo.confianca),
    observacao: vinculo.observacao,
    valorAtribuido: decimalToNumber(vinculo.valorAtribuido),
    origem: vinculo.origem as OrigemVinculo,
    decisao: vinculo.decisao as DecisaoVinculo,
    criterios: vinculo.criterios,
    divergencias: [],
    justificativaCurta: vinculo.justificativaCurta,
    camposUsados: vinculo.camposUsados,
    modelo: vinculo.modelo,
    promptVersion: vinculo.promptVersion,
    inputHash: vinculo.inputHash,
    criadoEm: vinculo.criadoEm.toISOString(),
    atualizadoEm: vinculo.atualizadoEm.toISOString(),
    revisadoEm: vinculo.revisadoEm?.toISOString() ?? null,
    revisadoPor: vinculo.revisadoPor,
    empenho,
  };
}

function dbEmpenhoToRecord(empenho: {
  id: string;
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
}): EmpenhoRecord {
  const raw = empenho.linhaBruta && typeof empenho.linhaBruta === "object"
    ? (empenho.linhaBruta as Record<string, unknown>)
    : undefined;

  return {
    id: empenho.id,
    ano: empenho.ano,
    numeroEmpenho: empenho.numeroEmpenho,
    dataEmpenho: empenho.dataEmpenho?.toISOString() ?? null,
    fornecedor: empenho.fornecedor,
    cnpjCpfFornecedor: empenho.cnpjCpfFornecedor,
    historico: empenho.historico,
    secretaria: empenho.secretaria,
    dotacao: empenho.dotacao,
    unidadeOrcamentaria: getRawField(raw, ["unidade orcamentaria", "unidade", "orgao"]),
    naturezaDespesa: getRawField(raw, ["natureza da despesa", "natureza", "elemento"]),
    modalidadeAplicacao: getRawField(raw, ["modalidade de aplicacao", "modalidade"]),
    fonteRecurso: getRawField(raw, ["fonte de recurso", "fonte"]),
    ficha: empenho.ficha,
    processoCompra: empenho.processoCompra,
    valorEmpenhado: decimalToNumber(empenho.valorEmpenhado) ?? 0,
    valorLiquidado: decimalToNumber(empenho.valorLiquidado) ?? 0,
    valorPago: decimalToNumber(empenho.valorPago) ?? 0,
    situacao: empenho.situacao,
    fonte: empenho.fonte,
    hashArquivo: empenho.hashArquivo,
    linhaBruta: raw,
  };
}

function toAnaliseResumo(analise: {
  id: string;
  emendaId: string;
  resultadoGeral: string;
  dataAnalise: Date;
  modelo: string | null;
  promptVersion: string | null;
  inputHash: string;
  quantidadeCandidatos: number;
  justificativa: string | null;
  erro: string | null;
}): AnaliseIaResumo {
  return buildAnaliseResumo({
    ...analise,
    resultadoGeral: analise.resultadoGeral as ResultadoAnaliseIa,
  });
}

function buildAnaliseResumo(analise: {
  id: string;
  emendaId: string;
  resultadoGeral: ResultadoAnaliseIa;
  dataAnalise: Date;
  modelo: string | null;
  promptVersion: string | null;
  inputHash: string;
  quantidadeCandidatos: number;
  justificativa: string | null;
  erro: string | null;
}): AnaliseIaResumo {
  return {
    ...analise,
    dataAnalise: analise.dataAnalise.toISOString(),
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  runner: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await runner(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

async function retryTemporary<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTemporaryOpenAiError(error)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }

  throw lastError;
}

function isTemporaryOpenAiError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return status === 429 || status >= 500 || message.includes("timeout") || message.includes("network");
}

function mergeStrings(...lists: Array<string[] | undefined>) {
  return Array.from(new Set(lists.flatMap((list) => list ?? []).filter(Boolean)));
}

function primaryCriterio(candidate: DeterministicCandidate) {
  if (candidate.divergencias.length || candidate.scoreDeterministico < 0.58) {
    return "conferir";
  }

  if (candidate.criteriosEncontrados.some((criterio) => criterio.startsWith("acao_") || criterio === "dotacao_correspondente")) {
    return "acao_dotacao";
  }

  if (candidate.criteriosEncontrados.some((criterio) => criterio.startsWith("entidade_") || criterio === "favorecido_compativel")) {
    return "codigo_secretaria";
  }

  if (candidate.criteriosEncontrados.includes("historico_ou_objeto_compativel")) {
    return "historico_secretaria";
  }

  return "similaridade_objeto";
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "object" && value && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonOrUndefined(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getRawField(row: Record<string, unknown> | undefined, names: string[]) {
  if (!row) {
    return null;
  }

  const normalizedNames = names.map(normalizeText);
  const entry = Object.entries(row).find(([key]) =>
    normalizedNames.some((name) => normalizeText(key).includes(name)),
  );

  return entry?.[1] ? String(entry[1]) : null;
}

function maskCpfCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) {
    return value;
  }

  return `${digits.slice(0, 4)}***${digits.slice(-2)}`;
}
