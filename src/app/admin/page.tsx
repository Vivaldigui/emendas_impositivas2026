import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Database,
  DownloadCloud,
} from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";

import { AdminLogin } from "@/components/admin/admin-login";
import { CollectButton } from "@/components/admin/collect-button";
import { LogoutButton } from "@/components/admin/logout-button";
import { EmendasExplorer } from "@/components/dashboard/emendas-explorer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDashboardData } from "@/services/dashboardService";
import { getIaUsageSummary } from "@/services/aiEmpenhoLinker";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel administrativo • Emendas Itanhandu",
  description: "Revisão de vínculos, status da IA e operação da coleta de empenhos.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const cookieStore = await cookies();
  const admin = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!admin) {
    return <AdminLogin />;
  }

  const [data, iaUsage] = await Promise.all([
    getDashboardData(),
    getIaUsageSummary(),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:text-emerald-900"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar ao painel público
        </Link>
        <LogoutButton nome={admin.nome} />
      </div>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Painel administrativo
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Revisão de vínculos sugeridos pela IA e operação da coleta de empenhos.
          Suas ações ficam registradas em auditoria com o seu nome.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800">
                <DownloadCloud className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-bold text-slate-950">Coleta de empenhos</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Coleta manual sob demanda (01/01/2026 até hoje). A coleta automática
                  está desativada para evitar custos.
                </p>
              </div>
            </div>

            <CollectButton />

            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                <strong>Última coleta:</strong>{" "}
                {data.ultimaColeta
                  ? formatDate(data.ultimaColeta.dataColeta)
                  : "ainda não executada"}
              </p>
              <p>
                <strong>Arquivo:</strong>{" "}
                {data.ultimaColeta?.nomeArquivo ?? "não localizado"}
              </p>
              <p>
                <strong>Registros importados:</strong>{" "}
                {data.ultimaColeta?.registrosImportados ?? 0}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 font-semibold text-slate-800 hover:bg-slate-50"
                href="/api/admin/coletas/empenhos"
              >
                <Database className="h-4 w-4" aria-hidden />
                Histórico de coletas (JSON)
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 font-semibold text-slate-800 hover:bg-slate-50"
                href="/api/admin/ia/revisoes"
              >
                <BrainCircuit className="h-4 w-4" aria-hidden />
                Histórico de revisões (JSON)
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-bold text-slate-950">Status da IA</h2>
            <div className="space-y-1 text-sm text-slate-700">
              <p>
                <strong>Habilitada:</strong> {data.ia.enabled ? "sim" : "não"}
              </p>
              <p>
                <strong>Disponível:</strong>{" "}
                {data.ia.available ? "sim (chave configurada)" : "não"}
              </p>
              <p>
                <strong>Modelo:</strong> {data.ia.model}
              </p>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              A IA só sugere — confirmação é manual e fica auditada com data, usuário
              e justificativa.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <UsageCard title="Hoje" usage={iaUsage.hoje} />
        <UsageCard title="Este mês" usage={iaUsage.mes} />
        <UsageCard title="Total registrado" usage={iaUsage.total} />
      </section>

      {data.alertasAdmin.length ? (
        <section className="grid gap-3 lg:grid-cols-3">
          {data.alertasAdmin.map((alerta) => (
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
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {alerta.descricao}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">Explorer com revisão</h2>
        <p className="text-sm leading-6 text-slate-600">
          Você está autenticado — as ações de Confirmar, Rejeitar, Editar valor e
          Analisar por IA já estão liberadas.
        </p>
        <EmendasExplorer
          emendas={data.emendas}
          ia={data.ia}
          vereadores={data.vereadores}
        />
      </section>

      {data.logs.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-950">Logs recentes da coleta</h2>
          <Card>
            <CardContent>
              <ul className="divide-y divide-slate-100 text-sm">
                {data.logs.map((log, index) => (
                  <li
                    key={`${log.timestamp}-${index}`}
                    className="grid gap-1 py-2 sm:grid-cols-[160px_120px_1fr]"
                  >
                    <span className="text-xs text-slate-500">
                      {formatDate(log.timestamp)}
                    </span>
                    <Badge variant={logVariant(log.status)}>{log.etapa}</Badge>
                    <span className="text-slate-700">
                      {log.mensagem}
                      {log.erro ? (
                        <span className="block text-rose-700">{log.erro}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

function logVariant(status: string) {
  if (status === "SUCESSO") return "green";
  if (status === "ERRO") return "red";
  return "amber";
}

function UsageCard({
  title,
  usage,
}: {
  title: string;
  usage: Awaited<ReturnType<typeof getIaUsageSummary>>["hoje"];
}) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-slate-950">Uso IA • {title}</h2>
          <Badge variant="blue">{usage.modelo ?? "sem modelo"}</Badge>
        </div>
        <p className="text-2xl font-extrabold tracking-tight text-slate-950">
          {formatUsd(usage.custoEstimadoUsd)}
        </p>
        <div className="grid gap-1 text-xs text-slate-600">
          <span>Tokens totais: {formatInteger(usage.tokensTotal)}</span>
          <span>Entrada: {formatInteger(usage.tokensEntrada)}</span>
          <span>Entrada em cache: {formatInteger(usage.tokensEntradaCache)}</span>
          <span>Saída: {formatInteger(usage.tokensSaida)}</span>
        </div>
        <p className="text-xs leading-5 text-slate-500">
          Valor estimado por token retornado pela API. A cobrança real deve ser conferida na
          conta OpenAI.
        </p>
      </CardContent>
    </Card>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
    style: "currency",
  }).format(value);
}

function formatInteger(value: number) {
  return value.toLocaleString("pt-BR");
}
