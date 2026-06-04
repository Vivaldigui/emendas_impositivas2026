import * as XLSX from "xlsx";

import { parseEmpenhosFile } from "@/collectors/sonner/empenhosParser";
import { matchEmpenhosForEmenda } from "@/services/emendaMatcher";
import { emendas } from "@/data/emendas";
import type { EmpenhoRecord } from "@/lib/types";

const rows = [
  [
    "Empenho",
    "Data Empenho",
    "Fornecedor",
    "Historico",
    "Dotacao",
    "Valor Empenhado",
    "Valor Liquidado",
    "Valor Pago",
  ],
  [
    "123",
    "04/06/2026",
    "Clinica Oftalmologica",
    "Consultas, exames e cirurgias oftalmologicas",
    "02.07.01.10.302.00.23.3006.3.3.50.39",
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

if (parsed.registros.length !== 1) {
  throw new Error(`Parser deveria retornar 1 empenho, retornou ${parsed.registros.length}.`);
}

const emendaForte = emendas.find((item) => item.id === "cleberson-oftalmologia");

if (!emendaForte) {
  throw new Error("Emenda de teste nao localizada.");
}

const strongMatches = matchEmpenhosForEmenda(emendaForte, parsed.registros);

if (strongMatches[0]?.criterio !== "acao_dotacao") {
  throw new Error(`Matcher forte falhou: ${strongMatches[0]?.criterio ?? "sem match"}.`);
}

const suggested: EmpenhoRecord = {
  id: "manual-1",
  ano: 2026,
  numeroEmpenho: "999",
  dataEmpenho: "2026-06-04T12:00:00.000Z",
  fornecedor: "Fornecedor de placas",
  historico: "Aquisicao de placas de conscientizacao e materiais para Rio Verde",
  secretaria: "Secretaria do Meio Ambiente",
  dotacao: null,
  ficha: null,
  processoCompra: null,
  valorEmpenhado: 5000,
  valorLiquidado: 0,
  valorPago: 0,
  situacao: "Ativo",
  fonte: "teste",
};
const emendaSugerida = emendas.find((item) => item.id === "vinicius-rio-verde");

if (!emendaSugerida) {
  throw new Error("Emenda sugerida de teste nao localizada.");
}

const suggestedMatches = matchEmpenhosForEmenda(emendaSugerida, [suggested]);

if (!suggestedMatches.length || suggestedMatches[0].criterio === "acao_dotacao") {
  throw new Error("Matcher sugerido falhou.");
}

const ambiguousMatches = matchEmpenhosForEmenda(emendaSugerida, [
  suggested,
  { ...suggested, id: "manual-2", numeroEmpenho: "1000" },
]);

if (ambiguousMatches[0]?.criterio !== "conferir") {
  throw new Error("Matcher ambiguo deveria marcar conferir.");
}

console.log("Parser e matcher validados.");
