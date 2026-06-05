import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getEmendasResumo, getVereadoresResumo } from "@/services/dashboardService";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const vereadores = await getVereadoresResumo();
  const vereador = vereadores.find((item) => item.id === id);
  if (!vereador) {
    return { title: "Vereador não localizado" };
  }
  return {
    title: `${vereador.nome} • Emendas Impositivas`,
    description: `Acompanhamento das emendas impositivas indicadas por ${vereador.nome}.`,
  };
}

export default async function VereadorPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [vereadores, emendas] = await Promise.all([
    getVereadoresResumo(),
    getEmendasResumo(),
  ]);
  const vereador = vereadores.find((item) => item.id === id);

  if (!vereador) {
    notFound();
  }

  const emendasDoVereador = emendas.filter((item) => item.vereadorId === id);
  const pagas = emendasDoVereador.filter((item) => item.situacao === "Paga").length;
  const aguardando = emendasDoVereador.filter(
    (item) => item.situacao === "Aguardando empenho",
  ).length;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link
        className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:text-emerald-900"
        href="/"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar ao painel
      </Link>

      <header className="grid gap-4 sm:grid-cols-[120px_1fr] sm:items-center">
        <div className="relative h-28 w-28 overflow-hidden rounded-lg bg-slate-100">
          <Image
            alt={`Foto de ${vereador.nome}`}
            className="object-cover object-top"
            fill
            sizes="112px"
            src={vereador.foto}
          />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            {vereador.nome}
          </h1>
          {vereador.partido ? (
            <p className="text-sm font-semibold text-slate-600">{vereador.partido}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Badge variant="blue">{vereador.quantidadeEmendas} emenda(s)</Badge>
            {pagas ? <Badge variant="green">{pagas} paga(s)</Badge> : null}
            {aguardando ? (
              <Badge variant="amber">{aguardando} aguardando empenho</Badge>
            ) : null}
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Autorizado" value={formatCurrency(vereador.totalAutorizado)} />
            <Metric label="Empenhado" value={formatCurrency(vereador.totalEmpenhado)} />
            <Metric label="Pago" value={formatCurrency(vereador.totalPago)} />
            <Metric
              label="% executado"
              value={formatPercent(vereador.percentualExecucao)}
            />
          </div>
          <Progress value={vereador.percentualExecucao} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">
          Emendas indicadas ({emendasDoVereador.length})
        </h2>
        <div className="grid gap-3">
          {emendasDoVereador.map((emenda) => (
            <Link
              className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm"
              href={`/emendas/${emenda.id}`}
              key={emenda.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-slate-950">{emenda.descricao}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {emenda.area} • {emenda.secretaria}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-950">
                    {formatCurrency(emenda.valorAutorizado)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPercent(emenda.percentualExecucao)} executado
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <Badge variant={situacaoVariant(emenda.situacao)}>
                  {emenda.situacao === "Paga" ? (
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                  ) : emenda.situacao === "Aguardando empenho" ? (
                    <AlertCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                  ) : null}
                  {emenda.situacao}
                </Badge>
                <Progress className="ml-2 flex-1" value={emenda.percentualExecucao} />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-950">{value}</p>
    </div>
  );
}

function situacaoVariant(situacao: string) {
  if (situacao === "Paga" || situacao === "Liquidada") return "green";
  if (situacao === "Conferir") return "red";
  if (situacao === "Aguardando empenho") return "amber";
  return "blue";
}
