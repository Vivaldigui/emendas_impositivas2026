import {
  AlertTriangle,
  Database,
  ExternalLink,
  FileDown,
  Landmark,
  RefreshCcw,
  WalletCards,
} from "lucide-react";

import { DashboardCharts } from "@/components/charts/dashboard-charts";
import { EmendasPublicList } from "@/components/dashboard/emendas-public-list";
import { VereadorCard } from "@/components/dashboard/vereador-card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDashboardData } from "@/services/dashboardService";
import { formatCurrency, formatPercent } from "@/lib/utils";

// Cache de 60s no Next; o cron e ações admin invalidam via
// invalidateDashboardCache, então dados nunca ficam mais que 1min defasados.
export const revalidate = 60;

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <section className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr] lg:items-start">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-800">
            <Landmark className="h-4 w-4" aria-hidden />
            Câmara Municipal de Itanhandu
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
              Dashboard de Emendas Impositivas 2026
            </h1>
            <p className="max-w-3xl text-base leading-7 text-slate-700">
              Acompanhamento por vereador, área e situação financeira, com cruzamento
              dos empenhos oficiais extraídos do Portal Cidadão.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/api/dashboard" variant="secondary">
              API pública
              <ExternalLink className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-3 text-sm leading-6 text-slate-700">
            <h2 className="font-bold text-slate-950">Como ler este painel</h2>
            <p>
              Cada emenda passa por quatro etapas: <strong>Autorizado</strong> (valor
              previsto), <strong>Empenhado</strong> (reservado a um fornecedor),{" "}
              <strong>Liquidado</strong> (bem ou serviço entregue) e <strong>Pago</strong>{" "}
              (dinheiro pago ao beneficiário).
            </p>
            <p className="text-xs text-slate-500">
              Dados atualizados diariamente a partir do Portal Cidadão.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={WalletCards}
          label="Autorizado"
          value={formatCurrency(data.totals.totalAutorizado)}
        />
        <SummaryCard
          icon={RefreshCcw}
          label="Empenhado"
          value={formatCurrency(data.totals.totalEmpenhado)}
        />
        <SummaryCard
          icon={FileDown}
          label="Liquidado"
          value={formatCurrency(data.totals.totalLiquidado)}
        />
        <SummaryCard
          icon={Landmark}
          label="Pago"
          value={formatCurrency(data.totals.totalPago)}
        />
        <SummaryCard
          icon={Database}
          label="Execução"
          value={formatPercent(data.totals.percentualExecucao)}
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

      <section className="space-y-3">
        <SectionHeader
          title="Vereadores"
          description="Resumo individual com foto, valor autorizado e andamento financeiro."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.vereadores.map((vereador) => (
            <VereadorCard key={vereador.id} vereador={vereador} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Gráficos"
          description="Distribuição por área, situação e evolução dos empenhos importados."
        />
        <DashboardCharts
          evolucaoMensal={data.evolucaoMensal}
          porArea={data.porArea}
          porSituacao={data.porSituacao}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Emendas"
          description="Toque em uma emenda para ver o detalhamento e os empenhos vinculados."
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
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
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
    </main>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 break-words text-xl font-bold text-slate-950">{value}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800">
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
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
