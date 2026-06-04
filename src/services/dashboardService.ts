import { emendas, fontesDocumentos, vereadores } from "@/data/emendas";
import { gerarVinculosEmendasEmpenhos } from "@/services/emendaMatcher";
import {
  listStoredEmpenhosArtifacts,
  loadAllEmpenhos,
  readColetaLogs,
} from "@/services/empenhosStorage";
import type {
  EmendaResumo,
  EmpenhoRecord,
  SituacaoEmenda,
  VereadorResumo,
} from "@/lib/types";
import { clampPercent, normalizeText } from "@/lib/utils";

export type EmendasFilters = {
  vereadorId?: string;
  area?: string;
  situacao?: string;
  q?: string;
};

export async function getDashboardData() {
  const [emendasResumo, artifacts, logs] = await Promise.all([
    getEmendasResumo(),
    listStoredEmpenhosArtifacts(),
    readColetaLogs(20),
  ]);
  const totals = summarizeEmendas(emendasResumo);
  const vereadorResumo = summarizeVereadores(emendasResumo);
  const porArea = groupByArea(emendasResumo);
  const porSituacao = groupBySituacao(emendasResumo);
  const evolucaoMensal = groupEmpenhosByMonth(emendasResumo.flatMap((item) => item.vinculos.map((vinculo) => vinculo.empenho)));

  return {
    totals,
    vereadores: vereadorResumo,
    porArea,
    porSituacao,
    evolucaoMensal,
    emendas: emendasResumo,
    fontes: fontesDocumentos,
    ultimaColeta: artifacts[0] ?? null,
    logs,
    alertas: buildAlertas(emendasResumo, artifacts.length),
  };
}

export async function getVereadoresResumo() {
  return summarizeVereadores(await getEmendasResumo());
}

export async function getEmendasResumo(filters: EmendasFilters = {}) {
  const empenhos = await loadAllEmpenhos();
  const vinculos = gerarVinculosEmendasEmpenhos(empenhos);
  const empenhosById = new Map(empenhos.map((empenho) => [empenho.id, empenho]));
  const vereadoresById = new Map(vereadores.map((vereador) => [vereador.id, vereador]));
  const vinculosByEmenda = new Map<string, EmendaResumo["vinculos"]>();

  for (const vinculo of vinculos) {
    const empenho = empenhosById.get(vinculo.empenhoId);
    if (!empenho) {
      continue;
    }

    const list = vinculosByEmenda.get(vinculo.emendaId) ?? [];
    list.push({ ...vinculo, empenho });
    vinculosByEmenda.set(vinculo.emendaId, list);
  }

  const resumo = emendas.map((emenda) => {
    const vereador = vereadoresById.get(emenda.vereadorId);
    if (!vereador) {
      throw new Error(`Vereador nao localizado para emenda ${emenda.id}.`);
    }

    const emendaVinculos = vinculosByEmenda.get(emenda.id) ?? [];
    const valorEmpenhado = sum(emendaVinculos, (item) => item.empenho.valorEmpenhado);
    const valorLiquidado = sum(emendaVinculos, (item) => item.empenho.valorLiquidado);
    const valorPago = sum(emendaVinculos, (item) => item.empenho.valorPago);
    const saldo = Math.max(0, emenda.valorAutorizado - valorEmpenhado);
    const percentualExecucao = emenda.valorAutorizado
      ? clampPercent((valorEmpenhado / emenda.valorAutorizado) * 100)
      : 100;

    return {
      ...emenda,
      vereador,
      valorEmpenhado,
      valorLiquidado,
      valorPago,
      saldo,
      percentualExecucao,
      situacao: determineSituacao(emenda.valorAutorizado, emendaVinculos),
      vinculos: emendaVinculos.sort((left, right) => right.confianca - left.confianca),
    } satisfies EmendaResumo;
  });

  return applyFilters(resumo, filters);
}

function applyFilters(rows: EmendaResumo[], filters: EmendasFilters) {
  const query = normalizeText(filters.q);

  return rows.filter((item) => {
    const haystack = normalizeText(
      [
        item.descricao,
        item.vereador.nome,
        item.area,
        item.secretaria,
        item.codigo,
        item.acao,
        item.situacao,
      ].join(" "),
    );

    return (
      (!filters.vereadorId || item.vereadorId === filters.vereadorId) &&
      (!filters.area || item.area === filters.area) &&
      (!filters.situacao || item.situacao === filters.situacao) &&
      (!query || haystack.includes(query))
    );
  });
}

function summarizeEmendas(rows: EmendaResumo[]) {
  const totalAutorizado = sum(rows, (item) => item.valorAutorizado);
  const totalEmpenhado = sum(rows, (item) => item.valorEmpenhado);
  const totalLiquidado = sum(rows, (item) => item.valorLiquidado);
  const totalPago = sum(rows, (item) => item.valorPago);
  const saldo = Math.max(0, totalAutorizado - totalEmpenhado);

  return {
    totalAutorizado,
    totalEmpenhado,
    totalLiquidado,
    totalPago,
    saldo,
    percentualExecucao: totalAutorizado
      ? clampPercent((totalEmpenhado / totalAutorizado) * 100)
      : 0,
    quantidadeEmendas: rows.length,
    quantidadeVereadores: vereadores.length,
  };
}

function summarizeVereadores(rows: EmendaResumo[]): VereadorResumo[] {
  return vereadores.map((vereador) => {
    const items = rows.filter((item) => item.vereadorId === vereador.id);
    const totalAutorizado = sum(items, (item) => item.valorAutorizado);
    const totalEmpenhado = sum(items, (item) => item.valorEmpenhado);
    const totalLiquidado = sum(items, (item) => item.valorLiquidado);
    const totalPago = sum(items, (item) => item.valorPago);
    const saldo = Math.max(0, totalAutorizado - totalEmpenhado);

    return {
      ...vereador,
      totalAutorizado,
      totalEmpenhado,
      totalLiquidado,
      totalPago,
      saldo,
      percentualExecucao: totalAutorizado
        ? clampPercent((totalEmpenhado / totalAutorizado) * 100)
        : 0,
      quantidadeEmendas: items.length,
      pendencias: items.filter((item) => item.situacao !== "Paga").length,
    };
  });
}

function groupByArea(rows: EmendaResumo[]) {
  const map = new Map<string, { area: string; autorizado: number; empenhado: number; pago: number }>();

  for (const item of rows) {
    const current = map.get(item.area) ?? {
      area: item.area,
      autorizado: 0,
      empenhado: 0,
      pago: 0,
    };
    current.autorizado += item.valorAutorizado;
    current.empenhado += item.valorEmpenhado;
    current.pago += item.valorPago;
    map.set(item.area, current);
  }

  return Array.from(map.values()).sort((left, right) => right.autorizado - left.autorizado);
}

function groupBySituacao(rows: EmendaResumo[]) {
  const map = new Map<SituacaoEmenda, { situacao: SituacaoEmenda; quantidade: number; valor: number }>();

  for (const item of rows) {
    const current = map.get(item.situacao) ?? {
      situacao: item.situacao,
      quantidade: 0,
      valor: 0,
    };
    current.quantidade += 1;
    current.valor += item.valorAutorizado;
    map.set(item.situacao, current);
  }

  return Array.from(map.values());
}

function groupEmpenhosByMonth(empenhos: EmpenhoRecord[]) {
  const map = new Map<string, { mes: string; empenhado: number; liquidado: number; pago: number }>();

  for (const empenho of empenhos) {
    const date = empenho.dataEmpenho ? new Date(empenho.dataEmpenho) : null;
    const key =
      date && !Number.isNaN(date.getTime())
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        : "sem-data";
    const current = map.get(key) ?? {
      mes: key === "sem-data" ? "Sem data" : key,
      empenhado: 0,
      liquidado: 0,
      pago: 0,
    };
    current.empenhado += empenho.valorEmpenhado;
    current.liquidado += empenho.valorLiquidado;
    current.pago += empenho.valorPago;
    map.set(key, current);
  }

  return Array.from(map.values()).sort((left, right) => left.mes.localeCompare(right.mes));
}

function determineSituacao(
  valorAutorizado: number,
  vinculos: EmendaResumo["vinculos"],
): SituacaoEmenda {
  if (vinculos.some((vinculo) => vinculo.criterio === "conferir")) {
    return "Conferir";
  }

  const valorEmpenhado = sum(vinculos, (item) => item.empenho.valorEmpenhado);
  const valorLiquidado = sum(vinculos, (item) => item.empenho.valorLiquidado);
  const valorPago = sum(vinculos, (item) => item.empenho.valorPago);

  if (!valorEmpenhado) {
    return "Aguardando empenho";
  }

  if (valorAutorizado && valorPago >= valorAutorizado - 1) {
    return "Paga";
  }

  if (valorAutorizado && valorLiquidado >= valorAutorizado - 1) {
    return "Liquidada";
  }

  if (valorAutorizado && valorEmpenhado < valorAutorizado - 1) {
    return "Parcial";
  }

  return "Empenhada";
}

function buildAlertas(rows: EmendaResumo[], artifactsCount: number) {
  const alertas = [];
  const conferir = rows.filter((item) => item.situacao === "Conferir").length;
  const semEmpenho = rows.filter((item) => item.situacao === "Aguardando empenho").length;

  if (!artifactsCount) {
    alertas.push({
      titulo: "Coleta de empenhos ainda nao executada",
      descricao:
        "O dashboard esta exibindo a base das emendas. Rode a coleta para cruzar com os empenhos oficiais.",
      nivel: "medio",
    });
  }

  if (conferir) {
    alertas.push({
      titulo: `${conferir} emenda(s) precisam de conferencia`,
      descricao:
        "Ha mais de um empenho possivelmente relacionado. O sistema evita marcar esse vinculo como certeza.",
      nivel: "alto",
    });
  }

  if (semEmpenho) {
    alertas.push({
      titulo: `${semEmpenho} emenda(s) sem empenho vinculado`,
      descricao:
        "Essas emendas ainda nao tiveram empenho localizado nos artefatos importados.",
      nivel: "baixo",
    });
  }

  return alertas;
}

function sum<T>(rows: T[], getter: (item: T) => number) {
  return Number(rows.reduce((total, item) => total + getter(item), 0).toFixed(2));
}
