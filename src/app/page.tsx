import {
  AlertTriangle,
  CalendarClock,
  Database,
  ExternalLink,
  FileDown,
  Landmark,
  RefreshCcw,
  WalletCards,
} from "lucide-react";

import { DashboardCharts } from "@/components/charts/dashboard-charts";
import { EmendasExplorer } from "@/components/dashboard/emendas-explorer";
import { VereadorCard } from "@/components/dashboard/vereador-card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDashboardData } from "@/services/dashboardService";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <section className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr] lg:items-start">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-800">
            <Landmark className="h-4 w-4" aria-hidden />
            Camara Municipal de Itanhandu
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
              Dashboard de Emendas Impositivas 2026
            </h1>
            <p className="max-w-3xl text-base leading-7 text-slate-700">
              Acompanhamento por vereador, area e situacao financeira, com cruzamento
              dos empenhos oficiais extraidos do Portal Cidadao.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/api/dashboard" variant="secondary">
              API dashboard
              <ExternalLink className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/api/admin/coletas/empenhos" variant="secondary">
              Historico de coletas
              <Database className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800">
                <CalendarClock className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-bold text-slate-950">Coleta diaria</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Agendada para 07:00, consultando 01/01/2026 ate o dia da coleta.
                </p>
              </div>
            </div>
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                <strong>Ultima coleta:</strong>{" "}
                {data.ultimaColeta ? formatDate(data.ultimaColeta.dataColeta) : "ainda nao executada"}
              </p>
              <p>
                <strong>Arquivo:</strong>{" "}
                {data.ultimaColeta?.nomeArquivo ?? "nao localizado"}
              </p>
            </div>
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
          label="Execucao"
          value={formatPercent(data.totals.percentualExecucao)}
        />
      </section>

      {data.alertas.length ? (
        <section className="grid gap-3 lg:grid-cols-3">
          {data.alertas.map((alerta) => (
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
          title="Graficos"
          description="Distribuicao por area, situacao e evolucao dos empenhos importados."
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
          description="Lista filtravel, compacta no celular, com detalhes em expansao."
        />
        <EmendasExplorer emendas={data.emendas} vereadores={data.vereadores} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardContent>
            <h2 className="font-bold text-slate-950">Fontes oficiais preservadas</h2>
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

        <Card>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <h2 className="font-bold text-slate-950">Operacao</h2>
            <p>
              Coleta manual via API: <code>POST /api/admin/coletas/empenhos</code>.
              Em producao, envie <code>Authorization: Bearer COLETA_ADMIN_SECRET</code>.
            </p>
            <p>
              CLI local:{" "}
              <code>
                npm run collect:empenhos -- --inicio=2026-01-01 --fim=hoje --formato=excel
                --modo=auto
              </code>
            </p>
            <p>
              Vínculos sugeridos aparecem como conferencia quando ha ambiguidade; o
              sistema nao transforma similaridade em certeza.
            </p>
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
