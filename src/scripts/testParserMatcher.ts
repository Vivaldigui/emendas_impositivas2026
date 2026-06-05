import assert from "node:assert/strict";

import * as XLSX from "xlsx";

import { parseEmpenhosFile } from "@/collectors/sonner/empenhosParser";
import { emendas } from "@/data/emendas";
import type { EmpenhoRecord } from "@/lib/types";
import { gerarCandidatosDeterministicos, matchEmpenhosForEmenda } from "@/services/emendaMatcher";

const rows = [
  [
    "Empenho",
    "Data Empenho",
    "Fornecedor",
    "Historico",
    "Dotacao",
    "Natureza da Despesa",
    "Fonte de Recurso",
    "Valor Empenhado",
    "Valor Liquidado",
    "Valor Pago",
  ],
  [
    "123",
    "04/06/2026",
    "Clinica Oftalmologica",
    "Consultas, exames e cirurgias oftalmologicas",
    "02.07.01.10.302.00.23.3006.3.3.90.39",
    "3.3.90.39",
    "1500",
    "R$ 41.183,80",
    "R$ 0,00",
    "R$ 0,00",
  ],
];
const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Empenhos");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
const parsed = parseEmpenhosFile({
  buffer,
  extension: "xlsx",
  hashArquivo: "test",
});

assert.equal(parsed.registros.length, 1, "Parser deveria retornar 1 empenho.");
assert.equal(parsed.registros[0].naturezaDespesa, "3.3.90.39");
assert.equal(parsed.registros[0].fonteRecurso, "1500");

const oftalmologia = mustEmenda("cleberson-oftalmologia");
const strongMatches = matchEmpenhosForEmenda(oftalmologia, parsed.registros);
assert.equal(strongMatches[0]?.criterio, "acao_dotacao", "Correspondencia clara por acao falhou.");

const rioVerde = mustEmenda("vinicius-rio-verde");
const rioVerdeParcial1 = empenho("parcial-1", {
  numeroEmpenho: "200",
  fornecedor: "Grafica Mantiqueira",
  historico: "Aquisicao de placas de conscientizacao para o programa O Rio Verde comeca aqui",
  secretaria: "Secretaria do Meio Ambiente",
  valorEmpenhado: 2500,
});
const rioVerdeParcial2 = empenho("parcial-2", {
  numeroEmpenho: "201",
  fornecedor: "Comercial de Materiais",
  historico: "Materiais educativos do projeto O Rio Verde comeca aqui",
  secretaria: "Meio Ambiente",
  valorEmpenhado: 2500,
});
assert.ok(
  matchEmpenhosForEmenda(rioVerde, [rioVerdeParcial1, rioVerdeParcial2]).length >= 2,
  "Emenda executada por varios empenhos deveria gerar candidatos.",
);

const larTransferencia = empenho("repasse-lar", {
  numeroEmpenho: "3306",
  fornecedor: "Lar dos Idosos de Itanhandu",
  historico: "Subvencao social para custeio do Lar dos Idosos",
  secretaria: "Secretaria de Desenvolvimento Social",
  dotacao: "04.004.08.244.3306.3.3.50.43",
  naturezaDespesa: "3.3.50.43",
  modalidadeAplicacao: "Transferencia a instituicoes privadas sem fins lucrativos",
  valorEmpenhado: 20499.48,
});
assert.ok(
  matchEmpenhosForEmenda(mustEmenda("rivaldo-lar-idosos"), [larTransferencia]).length > 0,
  "Transferencia/subvencao ao Lar dos Idosos deveria ser candidata.",
);
assert.ok(
  matchEmpenhosForEmenda(mustEmenda("vinicius-lar-idosos"), [larTransferencia]).length > 0,
  "Um empenho pode reunir emendas de vereadores diferentes.",
);

const apaamContribuicao = empenho("contrib-apaam", {
  numeroEmpenho: "3304",
  fornecedor: "APAAM",
  historico: "Contribuicoes para castracoes, vacinas e remedios da APAAM",
  secretaria: "Protecao Animal",
  dotacao: "04.001.18.541.3304.3.3.50.41",
  naturezaDespesa: "3.3.50.41",
  valorEmpenhado: 39000,
});
assert.ok(
  matchEmpenhosForEmenda(mustEmenda("eder-apaam"), [apaamContribuicao]).length > 0,
  "Contribuicao 3.3.50.41 deveria ser candidata.",
);

const fornecedorDiferente = empenho("fornecedor-diferente", {
  fornecedor: "Comercial Equipamentos LTDA",
  historico: "Equipamentos e instrumentos para projeto culinaria do Instituto Superacao",
  secretaria: "Secretaria de Desenvolvimento Social",
  valorEmpenhado: 2500,
});
assert.ok(
  matchEmpenhosForEmenda(mustEmenda("vinicius-instituto-superacao"), [fornecedorDiferente]).length > 0,
  "Fornecedor diferente da entidade beneficiaria ainda pode executar compra direta.",
);

const semCandidato = empenho("sem-candidato", {
  fornecedor: "Fornecedor aleatorio",
  historico: "Servico de manutencao predial sem relacao com exames",
  secretaria: "Administracao",
  valorEmpenhado: 1234,
});
assert.equal(
  matchEmpenhosForEmenda(mustEmenda("vinicius-saude-mulher"), [semCandidato]).length,
  0,
  "Emenda sem candidato nao deveria receber vinculo.",
);

const mesmoValorObjetoDiferente = empenho("valor-igual-objeto-diferente", {
  fornecedor: "Casa de Fogoes",
  historico: "Compra de fogao industrial para AABB Comunidade",
  secretaria: "Fundacao",
  valorEmpenhado: 5000,
});
assert.equal(
  matchEmpenhosForEmenda(rioVerde, [mesmoValorObjetoDiferente]).length,
  0,
  "Valores iguais com objetos diferentes nao devem gerar correspondencia.",
);

const apenasValor = empenho("apenas-valor", {
  fornecedor: "Fornecedor sem contexto",
  historico: "Despesa geral",
  secretaria: "Administracao",
  valorEmpenhado: rioVerde.valorAutorizado,
});
assert.equal(
  gerarCandidatosDeterministicos(rioVerde, [apenasValor]).length,
  0,
  "Valor isolado e insuficiente para gerar candidato.",
);

console.log("Parser e matcher validados.");

function mustEmenda(id: string) {
  const emenda = emendas.find((item) => item.id === id);
  assert.ok(emenda, `Emenda ${id} nao localizada.`);
  return emenda;
}

function empenho(
  id: string,
  overrides: Partial<EmpenhoRecord> = {},
): EmpenhoRecord {
  return {
    id,
    ano: 2026,
    numeroEmpenho: "999",
    dataEmpenho: "2026-06-04T12:00:00.000Z",
    fornecedor: "Fornecedor teste",
    cnpjCpfFornecedor: null,
    historico: null,
    secretaria: null,
    dotacao: null,
    unidadeOrcamentaria: null,
    naturezaDespesa: null,
    modalidadeAplicacao: null,
    fonteRecurso: null,
    ficha: null,
    processoCompra: null,
    valorEmpenhado: 0,
    valorLiquidado: 0,
    valorPago: 0,
    situacao: "Ativo",
    fonte: "teste",
    hashArquivo: "test",
    linhaBruta: {},
    ...overrides,
  };
}
