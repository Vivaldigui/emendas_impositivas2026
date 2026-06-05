import { ArrowLeft, Building2, ExternalLink, FileText, ScrollText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ShareButton } from "@/components/dashboard/share-button";
import { TimelineExecucao } from "@/components/dashboard/timeline-execucao";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getEmendas } from "@/services/emendasRepository";
import { getEmendasResumo } from "@/services/dashboardService";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";

export const revalidate = 60;
// Pré-gera no build as 93 emendas; novas IDs caem no fallback dinâmico.
export const dynamicParams = true;
export async function generateStaticParams() {
  try {
    const emendas = await getEmendas();
    return emendas.map((emenda) => ({ id: emenda.id }));
  } catch {
    return [];
  }
}

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const emendas = await getEmendasResumo();
  const emenda = emendas.find((item) => item.id === id);

  if (!emenda) {
    return { title: "Emenda não localizada" };
  }

  return {
    title: `${emenda.descricao.slice(0, 60)} • Emenda de ${emenda.vereador.nome}`,
    description: `Acompanhamento da emenda impositiva: ${emenda.descricao}`,
  };
}

export default async function EmendaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const emendas = await getEmendasResumo();
  const emenda = emendas.find((item) => item.id === id);

  if (!emenda) {
    notFound();
  }

  const empenhosVisiveis = emenda.vinculos.filter(
    (vinculo) => vinculo.decisao !== "REJEITADO",
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:text-emerald-900"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar ao painel
        </Link>
        <ShareButton
          title={`Emenda de ${emenda.vereador.nome}`}
          text={`${emenda.descricao} — ${formatPercent(emenda.percentualExecucao)} executado`}
        />
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Link
            className="font-semibold text-emerald-800 hover:underline"
            href={`/vereadores/${emenda.vereador.id}`}
          >
            {emenda.vereador.nome}
          </Link>
          <span>•</span>
          <span>{emenda.area}</span>
          <span>•</span>
          <span>{emenda.secretaria}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
          {emenda.descricao}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={situacaoVariant(situacaoPublica(emenda.situacao))}>
            {situacaoPublica(emenda.situacao)}
          </Badge>
          {emenda.codigo ? <Badge variant="neutral">Código {emenda.codigo}</Badge> : null}
          {emenda.acao ? <Badge variant="neutral">Ação {emenda.acao}</Badge> : null}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Valor autorizado
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-950">
                {formatCurrency(emenda.valorAutorizado)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                % executado
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-950">
                {formatPercent(emenda.percentualExecucao)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Saldo a executar
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-950">
                {formatCurrency(emenda.saldo)}
              </p>
            </div>
          </div>
          <Progress value={emenda.percentualExecucao} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">Andamento da execução</h2>
        <p className="text-sm leading-6 text-slate-600">
          Toda emenda impositiva passa por quatro etapas oficiais. Cada etapa é um marco
          contábil: ela diz onde o dinheiro está hoje.
        </p>
        <TimelineExecucao
          valorAutorizado={emenda.valorAutorizado}
          valorEmpenhado={emenda.valorEmpenhado}
          valorLiquidado={emenda.valorLiquidado}
          valorPago={emenda.valorPago}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">
          Empenhos vinculados ({empenhosVisiveis.length})
        </h2>
        {empenhosVisiveis.length ? (
          <div className="space-y-3">
            {empenhosVisiveis.map((vinculo) => (
              <Card key={`${vinculo.empenhoId}-${vinculo.id ?? "regra"}`}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Empenho
                      </p>
                      <p className="text-lg font-bold text-slate-950">
                        {vinculo.empenho.numeroEmpenho ?? "sem número"}
                      </p>
                      <p className="text-sm text-slate-600">
                        <Building2 className="mr-1 inline h-4 w-4" aria-hidden />
                        {vinculo.empenho.fornecedor ?? "Fornecedor não localizado"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Valor
                      </p>
                      <p className="text-lg font-bold text-slate-950">
                        {formatCurrency(vinculo.empenho.valorEmpenhado)}
                      </p>
                      <p className="text-xs text-slate-500">
                        em {formatDate(vinculo.empenho.dataEmpenho)}
                      </p>
                    </div>
                  </div>
                  {vinculo.justificativaCurta || vinculo.observacao ? (
                    <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                      <ScrollText className="mr-1 inline h-4 w-4" aria-hidden />
                      {vinculo.justificativaCurta || vinculo.observacao}
                    </p>
                  ) : null}
                  <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                    <Info label="Liquidado" value={formatCurrency(vinculo.empenho.valorLiquidado)} />
                    <Info label="Pago" value={formatCurrency(vinculo.empenho.valorPago)} />
                    <Info label="Situação" value={vinculo.empenho.situacao ?? "não informada"} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-sm text-slate-600">
              <FileText className="mr-1 inline h-4 w-4" aria-hidden />
              Nenhum empenho foi localizado para esta emenda nos arquivos importados.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">Glossário</h2>
        <Card>
          <CardContent className="space-y-3 text-sm leading-6 text-slate-700">
            <p>
              <strong>Emenda impositiva:</strong> destinação obrigatória de parte do
              orçamento municipal, indicada por cada vereador. O poder executivo é
              obrigado por lei a executá-la.
            </p>
            <p>
              <strong>Empenho:</strong> reserva oficial do dinheiro para um fornecedor
              ou entidade beneficiária. É a primeira etapa de execução.
            </p>
            <p>
              <strong>Liquidação:</strong> reconhecimento de que o bem foi entregue ou o
              serviço foi prestado. Sem liquidação não se pode pagar.
            </p>
            <p>
              <strong>Pagamento:</strong> saída efetiva do dinheiro do caixa público
              para o beneficiário final.
            </p>
            <p className="text-xs text-slate-500">
              Fonte oficial: Portal Cidadão da Prefeitura de Itanhandu.{" "}
              <a
                className="font-semibold text-emerald-800 hover:underline"
                href="/api/dashboard"
              >
                API pública <ExternalLink className="inline h-3 w-3" aria-hidden />
              </a>
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-950">{value}</p>
    </div>
  );
}

function situacaoPublica(situacao: string): string {
  if (situacao === "Paga") return "Paga";
  if (situacao === "Liquidada") return "Liquidada";
  if (situacao === "Aguardando empenho") return "Aguardando empenho";
  return "Em execução";
}

function situacaoVariant(situacao: string) {
  if (situacao === "Paga" || situacao === "Liquidada") return "green";
  if (situacao === "Aguardando empenho") return "amber";
  return "blue";
}
