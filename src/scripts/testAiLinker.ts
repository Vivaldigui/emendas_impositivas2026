import "dotenv/config";

import assert from "node:assert/strict";

import type { Emenda, EmpenhoRecord } from "@/lib/types";
import {
  analisarUmaEmenda,
  getHistoricoRevisoes,
  revisarVinculo,
  validateAiResult,
  type IaGenerateFn,
} from "@/services/aiEmpenhoLinker";
import { gerarCandidatosDeterministicos } from "@/services/emendaMatcher";
import { prisma } from "../../lib/prisma";

const PREFIX = `teste-ai-${Date.now()}`;
const oldApiKey = process.env.GEMINI_API_KEY;
const oldEnabled = process.env.IA_EMPENHO_ENABLED;
const oldModel = process.env.GEMINI_EMPENHO_MODEL;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL ausente; testes de auditoria Prisma ignorados.");
    return;
  }

  process.env.GEMINI_EMPENHO_MODEL = "gemini-test";

  await setupBaseRecords();
  await testSchemaAndCandidateProtection();
  await testOpenAiUnavailableFallback();
  await testInvalidAiResponses();
  await testIdempotencyAndDuplicateProtection();
  await testManualReviewAuditAndLimits();
  await testConfirmedLinkIsNotOverwritten();

  console.log("Servico IA, vinculos e auditoria validados.");
}

async function testSchemaAndCandidateProtection() {
  const emenda = makeEmenda(`${PREFIX}-schema`);
  const empenho = makeEmpenho(`${PREFIX}-schema-emp`);
  const candidatos = gerarCandidatosDeterministicos(emenda, [empenho]);

  assert.equal(candidatos.length, 1, "Candidato deterministico claro deveria existir.");
  assert.throws(
    () =>
      validateAiResult(
        {
          emendaId: emenda.id,
          decisaoGeral: "SUGERIR_VINCULOS",
          confiancaGeral: 0.8,
          vinculos: [
            {
              empenhoId: "id-inventado",
              valorAtribuido: 10,
              confianca: 0.8,
              criterios: ["historico"],
              divergencias: [],
              justificativaCurta: "Teste",
              camposUsados: ["historico"],
            },
          ],
          justificativaGeral: "Teste",
          alertas: [],
        },
        emenda,
        candidatos,
      ),
    /fora dos candidatos/,
    "IA nao pode inventar empenhoId fora dos candidatos.",
  );

  assert.throws(
    () =>
      validateAiResult(
        {
          emendaId: emenda.id,
          decisaoGeral: "SUGERIR_VINCULOS",
          confiancaGeral: 2,
          vinculos: [],
          justificativaGeral: "Teste invalido",
          alertas: [],
        } as never,
        emenda,
        candidatos,
      ),
    /Too big|menor|maior|Invalid/i,
    "Resposta fora do schema deve ser rejeitada.",
  );
}

async function testOpenAiUnavailableFallback() {
  const emenda = makeEmenda(`${PREFIX}-sem-chave`);
  const empenho = makeEmpenho(`${PREFIX}-sem-chave-emp`);

  delete process.env.GEMINI_API_KEY;
  process.env.IA_EMPENHO_ENABLED = "true";

  const result = await analisarUmaEmenda(emenda, [empenho], {
    dryRun: true,
    reanalisar: true,
  });

  assert.equal(result.iaDisponivel, false, "Sem GEMINI_API_KEY a IA deve ficar indisponivel.");
  assert.match(result.status, /SUGERIDO|CONFERIR/, "Matcher deterministico deve continuar funcionando.");

  process.env.IA_EMPENHO_ENABLED = "false";
  const disabled = await analisarUmaEmenda(emenda, [empenho], {
    dryRun: true,
    reanalisar: true,
  });
  assert.equal(disabled.iaDisponivel, false, "IA desativada nao deve chamar modelo.");
}

async function testInvalidAiResponses() {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.IA_EMPENHO_ENABLED = "true";

  const emenda = makeEmenda(`${PREFIX}-invalid`);
  const empenho = makeEmpenho(`${PREFIX}-invalid-emp`);

  const invalidSchema = await analisarUmaEmenda(emenda, [empenho], {
    dryRun: true,
    reanalisar: true,
    iaGenerate: fakeClient({
      emendaId: emenda.id,
      decisaoGeral: "SUGERIR_VINCULOS",
      confiancaGeral: 1.5,
      vinculos: [],
      justificativaGeral: "Invalido",
      alertas: [],
    }),
  });
  assert.equal(invalidSchema.status, "ERRO", "Resposta invalida da IA deve virar erro controlado.");

  const inventedId = await analisarUmaEmenda(emenda, [empenho], {
    dryRun: true,
    reanalisar: true,
    iaGenerate: fakeClient({
      emendaId: emenda.id,
      decisaoGeral: "SUGERIR_VINCULOS",
      confiancaGeral: 0.9,
      vinculos: [
        {
          empenhoId: "inventado",
          valorAtribuido: 10,
          confianca: 0.9,
          criterios: ["historico"],
          divergencias: [],
          justificativaCurta: "Inventado",
          camposUsados: ["historico"],
        },
      ],
      justificativaGeral: "Invalido",
      alertas: [],
    }),
  });
  assert.equal(inventedId.status, "ERRO", "ID fora dos candidatos deve virar erro controlado.");
}

async function testIdempotencyAndDuplicateProtection() {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.IA_EMPENHO_ENABLED = "true";

  const emenda = makeEmenda(`${PREFIX}-idempotente`);
  const empenho = makeEmpenho(`${PREFIX}-idempotente-emp`);
  await createDbEmenda(emenda);
  await createDbEmpenho(empenho);

  let calls = 0;
  const client = fakeClient(() => {
    calls += 1;
    return aiSuggestion(emenda, empenho, 80);
  });

  const first = await analisarUmaEmenda(emenda, [empenho], {
    reanalisar: true,
    iaGenerate: client,
  });
  assert.equal(first.status, "SUGERIDO");
  assert.equal(first.vinculos.length, 1);

  const second = await analisarUmaEmenda(emenda, [empenho], {
    reanalisar: false,
    iaGenerate: client,
  });
  assert.equal(second.status, "REAPROVEITADO", "Mesmo inputHash deve reaproveitar analise.");
  assert.equal(calls, 1, "Chamada duplicada nao deve consumir IA novamente.");

  await assert.rejects(
    () =>
      prisma.emendaEmpenhoVinculo.create({
        data: {
          emendaId: emenda.id,
          empenhoId: empenho.id,
          criterio: "acao_dotacao",
          observacao: "duplicado",
        },
      }),
    /Unique constraint|Unique/i,
    "Mesmo vinculo nao pode ser duplicado.",
  );
}

async function testManualReviewAuditAndLimits() {
  const emenda = makeEmenda(`${PREFIX}-review`, { valorAutorizado: 100 });
  const empenho = makeEmpenho(`${PREFIX}-review-emp`, { valorEmpenhado: 100 });
  const empenhoCompartilhado = makeEmpenho(`${PREFIX}-review-emp-2`, { valorEmpenhado: 100 });
  const empenhoAcimaEmenda = makeEmpenho(`${PREFIX}-review-emp-3`, { valorEmpenhado: 200 });
  const empenhoAcimaEmpenho = makeEmpenho(`${PREFIX}-review-emp-4`, { valorEmpenhado: 100 });
  await createDbEmenda(emenda);
  await createDbEmpenho(empenho);
  await createDbEmpenho(empenhoCompartilhado);
  await createDbEmpenho(empenhoAcimaEmenda);
  await createDbEmpenho(empenhoAcimaEmpenho);

  const confirmar = await createDbVinculo(`${PREFIX}-review-confirmar`, emenda.id, empenho.id, 50);
  const confirmed = await revisarVinculo({
    vinculoId: confirmar,
    acao: "CONFIRMAR",
    valorAtribuido: 50,
    revisadoPor: "teste",
  });
  assert.equal(confirmed.decisao, "CONFIRMADO", "Confirmacao manual deve marcar CONFIRMADO.");

  const rejeitar = await createDbVinculo(`${PREFIX}-review-rejeitar`, emenda.id, empenhoCompartilhado.id, 10);
  const rejected = await revisarVinculo({
    vinculoId: rejeitar,
    acao: "REJEITAR",
    revisadoPor: "teste",
  });
  assert.equal(rejected.decisao, "REJEITADO", "Rejeicao manual deve marcar REJEITADO.");

  const history = await getHistoricoRevisoes({ emendaId: emenda.id });
  assert.ok(history.revisoes.length >= 2, "Confirmacao e rejeicao devem gerar auditoria.");

  const acimaEmenda = await createDbVinculo(`${PREFIX}-acima-emenda`, emenda.id, empenhoAcimaEmenda.id, 10);
  await assert.rejects(
    () =>
      revisarVinculo({
        vinculoId: acimaEmenda,
        acao: "CONFIRMAR",
        valorAtribuido: 120,
        revisadoPor: "teste",
      }),
    /ultrapassa o valor autorizado da emenda/,
    "Soma acima do valor da emenda deve ser bloqueada.",
  );

  const outraEmenda = makeEmenda(`${PREFIX}-review-outra`, { valorAutorizado: 200 });
  await createDbEmenda(outraEmenda);
  const existente = await createDbVinculo(`${PREFIX}-empenho-existente`, outraEmenda.id, empenhoAcimaEmpenho.id, 80);
  await revisarVinculo({
    vinculoId: existente,
    acao: "CONFIRMAR",
    valorAtribuido: 80,
    revisadoPor: "teste",
  });
  const acimaEmpenho = await createDbVinculo(`${PREFIX}-acima-empenho`, emenda.id, empenhoAcimaEmpenho.id, 10);
  await assert.rejects(
    () =>
      revisarVinculo({
        vinculoId: acimaEmpenho,
        acao: "CONFIRMAR",
        valorAtribuido: 30,
        revisadoPor: "teste",
      }),
    /ultrapassa o valor do empenho/,
    "Soma acima do valor do empenho deve ser bloqueada.",
  );
}

async function testConfirmedLinkIsNotOverwritten() {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.IA_EMPENHO_ENABLED = "true";

  const emenda = makeEmenda(`${PREFIX}-confirmado`);
  const empenho = makeEmpenho(`${PREFIX}-confirmado-emp`);
  await createDbEmenda(emenda);
  await createDbEmpenho(empenho);
  const vinculoId = await createDbVinculo(`${PREFIX}-confirmado-vinculo`, emenda.id, empenho.id, 40);
  await revisarVinculo({
    vinculoId,
    acao: "CONFIRMAR",
    valorAtribuido: 40,
    revisadoPor: "teste",
  });

  const result = await analisarUmaEmenda(emenda, [empenho], {
    reanalisar: true,
    iaGenerate: fakeClient(aiSuggestion(emenda, empenho, 80)),
  });
  assert.equal(result.status, "SUGERIDO");
  assert.equal(result.vinculos.length, 0, "Analise nova nao deve sobrescrever vinculo confirmado.");

  const after = await prisma.emendaEmpenhoVinculo.findUniqueOrThrow({ where: { id: vinculoId } });
  assert.equal(after.decisao, "CONFIRMADO");
  assert.equal(Number(after.valorAtribuido), 40);
}

function fakeClient(resultOrFactory: unknown | (() => unknown)): IaGenerateFn {
  return async () => ({
    result:
      typeof resultOrFactory === "function"
        ? (resultOrFactory as () => unknown)()
        : resultOrFactory,
    uso: null,
  });
}

function aiSuggestion(emenda: Emenda, empenho: EmpenhoRecord, valorAtribuido: number) {
  return {
    emendaId: emenda.id,
    decisaoGeral: "SUGERIR_VINCULOS",
    confiancaGeral: 0.88,
    vinculos: [
      {
        empenhoId: empenho.id,
        valorAtribuido,
        confianca: 0.88,
        criterios: ["acao compativel", "historico compativel"],
        divergencias: [],
        justificativaCurta: "Acao, secretaria e objeto sao compativeis.",
        camposUsados: ["acao", "secretaria", "historico"],
      },
    ],
    justificativaGeral: "Sugestao para conferencia manual.",
    alertas: ["Nunca confirmar automaticamente."],
  };
}

async function setupBaseRecords() {
  await cleanup();
  await prisma.vereador.create({
    data: {
      id: `${PREFIX}-vereador`,
      nome: "Vereador Teste IA",
      nomeCurto: "Teste IA",
      foto: "/vereadores/teste.png",
    },
  });
}

async function createDbEmenda(emenda: Emenda) {
  await prisma.emenda.upsert({
    where: { id: emenda.id },
    create: {
      id: emenda.id,
      vereadorId: `${PREFIX}-vereador`,
      descricao: emenda.descricao,
      valorAutorizado: emenda.valorAutorizado,
      area: emenda.area,
      secretaria: emenda.secretaria,
      codigo: emenda.codigo,
      acao: emenda.acao,
      dotacao: emenda.dotacao,
      fonteDocumento: "teste",
    },
    update: {
      descricao: emenda.descricao,
      valorAutorizado: emenda.valorAutorizado,
      area: emenda.area,
      secretaria: emenda.secretaria,
      codigo: emenda.codigo,
      acao: emenda.acao,
      dotacao: emenda.dotacao,
    },
  });
}

async function createDbEmpenho(empenho: EmpenhoRecord) {
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
      hashArquivo: empenho.hashArquivo,
      linhaBruta: {},
    },
    update: {
      valorEmpenhado: empenho.valorEmpenhado,
      valorLiquidado: empenho.valorLiquidado,
      valorPago: empenho.valorPago,
      historico: empenho.historico,
      secretaria: empenho.secretaria,
      dotacao: empenho.dotacao,
    },
  });
}

async function createDbVinculo(id: string, emendaId: string, empenhoId: string, valorAtribuido: number) {
  const created = await prisma.emendaEmpenhoVinculo.create({
    data: {
      id,
      emendaId,
      empenhoId,
      criterio: "acao_dotacao",
      confianca: 0.8,
      observacao: "Sugestao de teste",
      valorAtribuido,
      origem: "IA",
      decisao: "SUGERIDO",
      criterios: ["teste"],
      justificativaCurta: "Sugestao de teste",
      camposUsados: ["teste"],
      modelo: "gpt-test",
      promptVersion: "teste",
      inputHash: `${id}-hash`,
    },
  });
  return created.id;
}

function makeEmenda(id: string, overrides: Partial<Emenda> = {}): Emenda {
  return {
    id,
    vereadorId: `${PREFIX}-vereador`,
    descricao: "Exames para saude da mulher",
    valorAutorizado: 100,
    area: "Saude",
    secretaria: "Secretaria de Saude",
    codigo: "07.004",
    acao: "3078",
    dotacao: "acao 3078",
    fonteDocumentoId: "teste",
    ...overrides,
  };
}

function makeEmpenho(id: string, overrides: Partial<EmpenhoRecord> = {}): EmpenhoRecord {
  return {
    id,
    ano: 2026,
    numeroEmpenho: "3078",
    dataEmpenho: "2026-06-04T12:00:00.000Z",
    fornecedor: "Clinica Saude Mulher",
    cnpjCpfFornecedor: null,
    historico: "Exames para saude da mulher conforme acao 3078",
    secretaria: "Secretaria Municipal de Saude",
    dotacao: "02.07.01.10.302.3078.3.3.90.39",
    unidadeOrcamentaria: "07.004",
    naturezaDespesa: "3.3.90.39",
    modalidadeAplicacao: "Aplicacao direta",
    fonteRecurso: "1500",
    ficha: null,
    processoCompra: null,
    valorEmpenhado: 100,
    valorLiquidado: 0,
    valorPago: 0,
    situacao: "Ativo",
    fonte: "teste",
    hashArquivo: "teste",
    linhaBruta: {},
    ...overrides,
  };
}

async function cleanup() {
  await prisma.emendaEmpenhoRevisao.deleteMany({
    where: {
      OR: [
        { emendaId: { startsWith: PREFIX } },
        { empenhoId: { startsWith: PREFIX } },
        { vinculoId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.emendaEmpenhoVinculo.deleteMany({
    where: {
      OR: [{ emendaId: { startsWith: PREFIX } }, { empenhoId: { startsWith: PREFIX } }],
    },
  });
  await prisma.analiseIaEmenda.deleteMany({ where: { emendaId: { startsWith: PREFIX } } });
  await prisma.empenho.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.emenda.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.vereador.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    process.env.GEMINI_API_KEY = oldApiKey;
    process.env.IA_EMPENHO_ENABLED = oldEnabled;
    process.env.GEMINI_EMPENHO_MODEL = oldModel;
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
