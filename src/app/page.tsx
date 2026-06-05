import {
  AlertTriangle,
  Database,
  ExternalLink,
  FileDown,
  Landmark,
  RefreshCcw,
  Sparkles,
  WalletCards,
} from "lucide-react";

import { DashboardCharts } from "@/components/charts/dashboard-charts";
import { EmendasPublicList } from "@/components/dashboard/emendas-public-list";
import { UpdatedAt } from "@/components/dashboard/updated-at";
import { VereadorCard } from "@/components/dashboard/vereador-card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDashboardData } from "@/services/dashboardService";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getDashboardData();

  const vereadoresOrdenados = [...data.vereadores].sort(
    (left, right) => right.percentualExecucao - left.percentualExecucao,
  );

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr] lg:items-start">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm backdrop-blur">
            <Landmark className="h-3.5 w-3.5" aria-hidden />
            Câmara Municipal de Itanhandu
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-3xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
              Emendas impositivas <span className="text-emerald-700">2026</span> em
              tempo real
            </h1>
            <p className="max-w-3xl text-base leading-7 text-slate-700">
              Acompanhe quanto cada vereador conseguiu executar das suas emendas — com
              dados oficiais cruzados diariamente com o Portal Cidadão da Prefeitura.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="#vereadores" variant="primary">
              Ver vereadores
            </ButtonLink>
            <ButtonLink href="#emendas" variant="secondary">
              Buscar emenda
            </ButtonLink>
            <ButtonLink href="/api/dashboard" variant="subtle">
              API pública
              <ExternalLink className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>

        <Card className="bg-white/85 backdrop-blur">
          <CardContent className="space-y-3 text-sm leading-6 text-slate-700">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="text-base font-bold text-slate-950">Como ler este painel</h2>
            </div>
            <p>
              Cada emenda passa por quatro etapas:{" "}
              <strong>Autorizado</strong> (valor previsto em lei),{" "}
              <strong>Empenhado</strong> (reservado a um fornecedor),{" "}
              <strong>Liquidado</strong> (bem ou serviço entregue) e{" "}
              <strong>Pago</strong> (dinheiro pago ao beneficiário).
            </p>
            <UpdatedAt iso={data.computedAt} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={WalletCards}
          label="Autorizado"
          value={formatCurrency(data.totals.totalAutorizado)}
          accent="emerald"
        />
        <SummaryCard
          icon={RefreshCcw}
          label="Empenhado"
          value={formatCurrency(data.totals.totalEmpenhado)}
          accent="sky"
        />
        <SummaryCard
          icon={FileDown}
          label="Liquidado"
          value={formatCurrency(data.totals.totalLiquidado)}
          accent="violet"
        />
        <SummaryCard
          icon={Landmark}
          label="Pago"
          value={formatCurrency(data.totals.totalPago)}
          accent="emerald"
        />
        <SummaryCard
          icon={Database}
          label="Execução"
          value={formatPercent(data.totals.percentualExecucao)}
          accent="amber"
          highlight
        />
      </section>

      {data.alertasPublicos.length ? (
        <section className="grid gap-3 lg:grid-cols-3">
          {data.alertasPublicos.map((alerta) => (
            <Card key={alerta.titulo}>
              <CardContent className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-slate-950">{alerta.titulo}</h2>
                    <Badge variant={alerta.nivel === "alto" ? "red" : "amber"}>
                      {alerta.nivel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{alerta.descricao}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <section id="vereadores" className="space-y-3 scroll-mt-6">
        <SectionHeader
          title="Vereadores"
          description="Ranking por % executado. Toque no card para ver as emendas do vereador."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {vereadoresOrdenados.map((vereador) => (
            <VereadorCard key={vereador.id} vereador={vereador} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Gráficos"
          description="Distribuição por área e evolução mensal dos empenhos importados."
        />
        <DashboardCharts
          evolucaoMensal={data.evolucaoMensal}
          porArea={data.porArea}
          porSituacao={data.porSituacao}
        />
      </section>

      <section id="emendas" className="space-y-3 scroll-mt-6">
        <SectionHeader
          title="Emendas"
          description="Filtre por vereador, área ou situação. Toque em uma emenda para ver os empenhos vinculados."
        />
        <EmendasPublicList emendas={data.emendas} vereadores={data.vereadores} />
      </section>

      <section>
        <Card>
          <CardContent>
            <h2 className="font-bold text-slate-950">Fontes oficiais</h2>
            <div className="mt-3 space-y-2 text-sm">
              {data.fontes.map((fonte) => (
                <a
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-slate-50"
                  href={fonte.href}
                  key={fonte.id}
                  target="_blank"
                >
                  <span>{fonte.titulo}</span>
                  <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <footer className="border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
        <p>
          Iniciativa da Câmara Municipal de Itanhandu • Dados públicos preservados em
          auditoria.
        </p>
      </footer>
    </main>
  );
}

const ACCENTS = {
  emerald: {
    icon: "bg-emerald-50 text-emerald-700",
    border: "border-emerald-100",
  },
  sky: {
    icon: "bg-sky-50 text-sky-700",
    border: "border-sky-100",
  },
  violet: {
    icon: "bg-violet-50 text-violet-700",
    border: "border-violet-100",
  },
  amber: {
    icon: "bg-amber-50 text-amber-700",
    border: "border-amber-100",
  },
} as const;

function SummaryCard({
  icon: Icon,
  label,
  value,
  accent = "emerald",
  highlight = false,
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
  accent?: keyof typeof ACCENTS;
  highlight?: boolean;
}) {
  const colors = ACCENTS[accent];
  return (
    <Card
      className={`${colors.border} ${highlight ? "bg-emerald-50/50" : "bg-white"}`}
    >
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p
            className={`mt-2 break-words text-xl font-extrabold tracking-tight text-slate-950 ${highlight ? "sm:text-2xl" : ""}`}
          >
            {value}
          </p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colors.icon}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
