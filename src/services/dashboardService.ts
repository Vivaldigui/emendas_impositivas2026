import {
  getEmendas,
  getFontesDocumentos,
  getVereadores,
} from "@/services/emendasRepository";
import {
  getOpenAiEmpenhoModel,
  isOpenAiEmpenhoEnabled,
  loadPersistedLinkState,
} from "@/services/aiEmpenhoLinker";
import {
  listStoredEmpenhosArtifacts,
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

// Cache em memória do dashboard. O cálculo de vínculos é O(emendas × empenhos)
// e fica caro. Como a coleta é diária, TTL de 5 min serve com folga;
// invalidação explícita acontece no cron e em cada ação admin.
const DASHBOARD_CACHE_TTL_MS = 5 * 60_000;
let dashboardCache:
  | { ts: number; data: Awaited<ReturnType<typeof computeDashboardData>> }
  | null = null;

export function invalidateDashboardCache() {
  dashboardCache = null;
  emendasResumoCache = null;
}

export async function getDashboardData() {
  if (dashboardCache && Date.now() - dashboardCache.ts < DASHBOARD_CACHE_TTL_MS) {
    return dashboardCache.data;
  }
  const data = await computeDashboardData();
  dashboardCache = { ts: Date.now(), data };
  return data;
}

async function computeDashboardData() {
  const computedAt = new Date().toISOString();
  const [emendasResumo, vereadoresList, artifacts, logs, fontes] = await Promise.all([
    getEmendasResumo(),
    getVereadores(),
    listStoredEmpenhosArtifacts(),
    readColetaLogs(20),
    getFontesDocumentos(),
  ]);
  const totals = summarizeEmendas(emendasResumo, vereadoresList.length);
  const vereadorResumo = summarizeVereadores(emendasResumo, vereadoresList);
  const porArea = groupByArea(emendasResumo);
  const porSituacao = groupBySituacao(emendasResumo);
  // Para o gráfico de evolução, considerar todos os vínculos não-rejeitados
  // (já filtramos REJEITADO no compute principal).
  const evolucaoMensal = groupVinculosByMonth(
    emendasResumo.flatMap((item) => item.vinculos),
  );

  return {
    totals,
    vereadores: vereadorResumo,
    porArea,
    porSituacao,
    evolucaoMensal,
    emendas: emendasResumo,
    fontes,
    ultimaColeta: artifacts[0] ?? null,
    logs,
    alertasPublicos: buildAlertasPublicos(emendasResumo),
    alertasAdmin: buildAlertasAdmin(emendasResumo, artifacts),
    ia: {
      enabled: process.env.OPENAI_EMPENHO_ENABLED !== "false",
      available: isOpenAiEmpenhoEnabled(),
      model: getOpenAiEmpenhoModel(),
    },
    computedAt,
  };
}

export async function getVereadoresResumo() {
  return (await getDashboardData()).vereadores;
}

// Cache do resumo sem filtros — usado por /emendas/[id] e /vereadores/[id].
// Esses caminhos não passam pelo cache do dashboard, por isso precisam do seu.
const EMENDAS_RESUMO_CACHE_TTL_MS = 5 * 60_000;
let emendasResumoCache:
  | { ts: number; data: Awaited<ReturnType<typeof computeEmendasResumo>> }
  | null = null;

export async function getEmendasResumo(filters: EmendasFilters = {}) {
  const hasFilters = Boolean(filters.vereadorId || filters.area || filters.situacao || filters.q);
  if (!hasFilters && emendasResumoCache && Date.now() - emendasResumoCache.ts < EMENDAS_RESUMO_CACHE_TTL_MS) {
    return emendasResumoCache.data;
  }
  const data = await computeEmendasResumo(filters);
  if (!hasFilters) {
    emendasResumoCache = { ts: Date.now(), data };
  }
  return data;
}

async function computeEmendasResumo(filters: EmendasFilters = {}) {
  const [baseEmendas, vereadoresList, persisted] = await Promise.all([
    getEmendas(),
    getVereadores(),
    safeLoadPersistedState(),
  ]);
  const vereadoresById = new Map(vereadoresList.map((vereador) => [vereador.id, vereador]));
  const vinculosByEmenda = new Map<string, EmendaResumo["vinculos"]>();

  for (const [emendaId, persistedVinculos] of persisted.vinculosByEmenda) {
    const merged = new Map<string, EmendaResumo["vinculos"][number]>();

    for (const vinculo of persistedVinculos) {
      merged.set(vinculoKey(vinculo), vinculo);
    }

    vinculosByEmenda.set(emendaId, Array.from(merged.values()));
  }

  // Eleger uma única emenda por empenho entre as não-confirmadas, para evitar
  // que o mesmo empenho seja somado em mais de uma emenda. Confirmados/Rejeitados
  // preservam decisão humana e não entram na eleição.
  const empenhoOwner = electEmpenhoOwners(vinculosByEmenda);

  const resumo = baseEmendas.map((emenda) => {
    const vereador = vereadoresById.get(emenda.vereadorId);
    if (!vereador) {
      throw new Error(`Vereador nao localizado para emenda ${emenda.id}.`);
    }

    const emendaVinculos = (vinculosByEmenda.get(emenda.id) ?? []).filter(
      (vinculo) => vinculo.decisao !== "REJEITADO",
    );
    const financialVinculos = emendaVinculos.filter((vinculo) =>
      isFinanciallyCountableVinculo(vinculo, emenda.id, empenhoOwner),
    );
    const valorEmpenhadoBruto = sum(financialVinculos, (item) =>
      attributedValue(item, "valorEmpenhado", emenda.valorAutorizado),
    );
    const valorLiquidadoBruto = sum(financialVinculos, (item) =>
      attributedValue(item, "valorLiquidado", emenda.valorAutorizado),
    );
    const valorPagoBruto = sum(financialVinculos, (item) =>
      attributedValue(item, "valorPago", emenda.valorAutorizado),
    );
    // Cap por valor autorizado da emenda: % executado nunca pode passar de 100%.
    const valorEmpenhado = emenda.valorAutorizado
      ? Math.min(emenda.valorAutorizado, valorEmpenhadoBruto)
      : 0;
    const valorLiquidado = emenda.valorAutorizado
      ? Math.min(emenda.valorAutorizado, valorLiquidadoBruto)
      : 0;
    const valorPago = emenda.valorAutorizado
      ? Math.min(emenda.valorAutorizado, valorPagoBruto)
      : 0;
    const saldo = Math.max(0, emenda.valorAutorizado - valorEmpenhado);
    const percentualExecucao = emenda.valorAutorizado
      ? clampPercent((valorEmpenhado / emenda.valorAutorizado) * 100)
      : 0;

    return {
      ...emenda,
      vereador,
      valorEmpenhado,
      valorLiquidado,
      valorPago,
      saldo,
      percentualExecucao,
      situacao: determineSituacao(
        emenda.valorAutorizado,
        valorEmpenhado,
        valorLiquidado,
        valorPago,
        emendaVinculos,
      ),
      vinculos: emendaVinculos.sort(
        (left, right) => (right.confianca ?? 0) - (left.confianca ?? 0),
      ),
      analiseIa: persisted.analiseByEmenda.get(emenda.id) ?? null,
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

function summarizeEmendas(rows: EmendaResumo[], totalVereadores: number) {
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
    quantidadeVereadores: totalVereadores,
  };
}

function summarizeVereadores(
  rows: EmendaResumo[],
  vereadoresList: Awaited<ReturnType<typeof getVereadores>>,
): VereadorResumo[] {
  return vereadoresList.map((vereador) => {
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

function groupVinculosByMonth(vinculos: EmendaResumo["vinculos"]) {
  const map = new Map<string, { mes: string; empenhado: number; liquidado: number; pago: number }>();

  for (const vinculo of vinculos) {
    const empenho = vinculo.empenho;
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
    // No gráfico de evolução, usamos o valor cheio do empenho (sem cap por emenda).
    current.empenhado += empenho.valorEmpenhado;
    current.liquidado += empenho.valorLiquidado;
    current.pago += empenho.valorPago;
    map.set(key, current);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      empenhado: Number(item.empenhado.toFixed(2)),
      liquidado: Number(item.liquidado.toFixed(2)),
      pago: Number(item.pago.toFixed(2)),
    }))
    .sort((left, right) => left.mes.localeCompare(right.mes));
}

function determineSituacao(
  valorAutorizado: number,
  valorEmpenhado: number,
  valorLiquidado: number,
  valorPago: number,
  vinculos: EmendaResumo["vinculos"],
): SituacaoEmenda {
  // Se tudo é só sugestão ou conferir, marca explicitamente "Conferir".
  const temConfirmado = vinculos.some((vinculo) => vinculo.decisao === "CONFIRMADO");
  const apenasSugestoes =
    !temConfirmado &&
    vinculos.length > 0 &&
    vinculos.every(
      (vinculo) =>
        vinculo.criterio === "conferir" ||
        vinculo.decisao === "CONFERIR" ||
        vinculo.decisao === "SUGERIDO",
    );

  if (apenasSugestoes) {
    return "Conferir";
  }

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

type Alerta = { titulo: string; descricao: string; nivel: "alto" | "medio" | "baixo" };

function buildAlertasPublicos(rows: EmendaResumo[]): Alerta[] {
  const alertas: Alerta[] = [];
  const atrasadas = identificarEmendasAtrasadas(rows);
  if (atrasadas.length) {
    alertas.push({
      titulo: `${atrasadas.length} emenda(s) em atraso no cronograma de ${new Date().getFullYear()}`,
      descricao: `Era esperada execução de ao menos ${Math.round(
        cronogramaEsperadoPercentual() * 100,
      )}% até hoje. Veja a lista filtrando por "Aguardando empenho".`,
      nivel: "medio",
    });
  }
  return alertas;
}

function buildAlertasAdmin(
  rows: EmendaResumo[],
  artifacts: Awaited<ReturnType<typeof listStoredEmpenhosArtifacts>>,
): Alerta[] {
  const alertas: Alerta[] = [];
  const conferir = rows.filter((item) => item.situacao === "Conferir").length;
  const semEmpenho = rows.filter((item) => item.situacao === "Aguardando empenho").length;
  const ultimoArtifact = artifacts[0] ?? null;
  const horasDesdeUltimaColeta = ultimoArtifact
    ? (Date.now() - new Date(ultimoArtifact.dataColeta).getTime()) / 36e5
    : null;

  if (!artifacts.length) {
    alertas.push({
      titulo: "Coleta de empenhos ainda não executada",
      descricao:
        "O dashboard está exibindo a base das emendas. Rode a coleta para cruzar com os empenhos oficiais.",
      nivel: "medio",
    });
  } else if (horasDesdeUltimaColeta !== null && horasDesdeUltimaColeta > 48) {
    alertas.push({
      titulo: `Última coleta há ${Math.round(horasDesdeUltimaColeta)}h`,
      descricao:
        "A coleta diária não roda há mais de 48 horas. Verifique o cron e o portal Cidadão.",
      nivel: "alto",
    });
  }

  if (ultimoArtifact && ultimoArtifact.registrosImportados === 0) {
    alertas.push({
      titulo: "Última coleta retornou zero registros",
      descricao:
        "Pode indicar quebra do parser por mudança no portal. Confira o artefato em storage/sonner/empenhos.",
      nivel: "alto",
    });
  }

  if (conferir) {
    alertas.push({
      titulo: `${conferir} emenda(s) precisam de conferência`,
      descricao:
        "Há mais de um empenho possivelmente relacionado. O sistema evita marcar esse vínculo como certeza.",
      nivel: "alto",
    });
  }

  if (semEmpenho) {
    alertas.push({
      titulo: `${semEmpenho} emenda(s) sem empenho vinculado`,
      descricao:
        "Essas emendas ainda não tiveram empenho localizado nos artefatos importados.",
      nivel: "baixo",
    });
  }

  return alertas;
}

function cronogramaEsperadoPercentual(now: Date = new Date()) {
  const start = new Date(now.getFullYear(), 0, 1).getTime();
  const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
  const elapsed = (now.getTime() - start) / (end - start);
  return Math.max(0, Math.min(1, elapsed));
}

function identificarEmendasAtrasadas(rows: EmendaResumo[]) {
  const esperado = cronogramaEsperadoPercentual();
  if (esperado < 0.25) return [];
  return rows.filter(
    (item) =>
      item.valorAutorizado > 0 &&
      item.percentualExecucao / 100 < esperado - 0.2 &&
      item.situacao !== "Paga",
  );
}

function sum<T>(rows: T[], getter: (item: T) => number) {
  return Number(rows.reduce((total, item) => total + getter(item), 0).toFixed(2));
}

async function safeLoadPersistedState() {
  try {
    return await loadPersistedLinkState();
  } catch (error) {
    console.warn("Nao foi possivel carregar vinculos persistidos.", {
      erro: error instanceof Error ? error.message : String(error),
    });

    return {
      vinculosByEmenda: new Map<string, EmendaResumo["vinculos"]>(),
      analiseByEmenda: new Map<string, NonNullable<EmendaResumo["analiseIa"]>>(),
    };
  }
}

function vinculoKey(vinculo: { emendaId: string; empenhoId: string }) {
  return `${vinculo.emendaId}:${vinculo.empenhoId}`;
}

function isFinanciallyCountableVinculo(
  vinculo: EmendaResumo["vinculos"][number],
  emendaId: string,
  empenhoOwner: Map<string, string>,
) {
  if (vinculo.decisao === "REJEITADO") return false;
  if (vinculo.decisao === "CONFIRMADO") return true;
  // SUGERIDO ou CONFERIR: só conta se esta emenda for "dona" deste empenho na eleição.
  return empenhoOwner.get(vinculo.empenhoId) === emendaId;
}

function electEmpenhoOwners(
  vinculosByEmenda: Map<string, EmendaResumo["vinculos"]>,
): Map<string, string> {
  // confirmados têm prioridade absoluta; entre os demais, vence o maior score (confiança × determinístico).
  const confirmedOwner = new Map<string, string>();
  type Candidate = { emendaId: string; score: number };
  const bestSuggested = new Map<string, Candidate>();

  for (const [emendaId, vinculos] of vinculosByEmenda) {
    for (const vinculo of vinculos) {
      if (vinculo.decisao === "REJEITADO") continue;
      if (vinculo.decisao === "CONFIRMADO") {
        confirmedOwner.set(vinculo.empenhoId, emendaId);
        continue;
      }
      const score =
        ((vinculo.confianca ?? 0) || (vinculo.scoreDeterministico ?? 0)) +
        (vinculo.scoreDeterministico ?? 0) * 0.5;
      const current = bestSuggested.get(vinculo.empenhoId);
      if (!current || score > current.score) {
        bestSuggested.set(vinculo.empenhoId, { emendaId, score });
      }
    }
  }

  const owner = new Map<string, string>();
  for (const [empenhoId, emendaId] of confirmedOwner) owner.set(empenhoId, emendaId);
  for (const [empenhoId, candidate] of bestSuggested) {
    if (!owner.has(empenhoId)) owner.set(empenhoId, candidate.emendaId);
  }
  return owner;
}

function attributedValue(
  vinculo: EmendaResumo["vinculos"][number],
  field: "valorEmpenhado" | "valorLiquidado" | "valorPago",
  valorAutorizadoEmenda: number,
) {
  // Valor explícito (geralmente quando humano editou): ratear o field correspondente.
  if (
    vinculo.valorAtribuido !== null &&
    vinculo.valorAtribuido !== undefined &&
    vinculo.valorAtribuido < vinculo.empenho.valorEmpenhado
  ) {
    if (!vinculo.empenho.valorEmpenhado) {
      return field === "valorEmpenhado" ? vinculo.valorAtribuido : 0;
    }
    const ratio = vinculo.valorAtribuido / vinculo.empenho.valorEmpenhado;
    return Number((vinculo.empenho[field] * ratio).toFixed(2));
  }

  // Caso geral (CONFIRMADO sem cap explícito, ou SUGERIDO eleito):
  // o vínculo contribui no máximo até o valor autorizado da emenda.
  const valor = vinculo.empenho[field];
  if (!valorAutorizadoEmenda || valor <= valorAutorizadoEmenda) {
    return valor;
  }
  return valorAutorizadoEmenda;
}
