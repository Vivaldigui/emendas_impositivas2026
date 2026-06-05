import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { VereadorResumo } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/utils";

export function VereadorCard({ vereador }: { vereador: VereadorResumo }) {
  const palette = executionPalette(vereador.percentualExecucao);

  return (
    <Link
      href={`/vereadores/${vereador.id}`}
      className="group block focus:outline-none"
    >
      <Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-emerald-300 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-emerald-500">
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
              <Image
                alt={`Foto de ${vereador.nome}`}
                className="object-cover object-top"
                fill
                sizes="64px"
                src={vereador.foto}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold text-slate-950">
                {vereador.nome}
              </h3>
              <p className="text-xs text-slate-500">
                {vereador.quantidadeEmendas} emenda(s)
                {vereador.partido ? ` • ${vereador.partido}` : ""}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Execução
              </span>
              <strong className={`text-lg font-bold ${palette.text}`}>
                {formatPercent(vereador.percentualExecucao)}
              </strong>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${palette.bar} transition-[width]`}
                style={{ width: `${Math.max(0, Math.min(100, vereador.percentualExecucao))}%` }}
              />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Autorizado</dt>
              <dd className="font-semibold text-slate-950">
                {formatCurrency(vereador.totalAutorizado)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Empenhado</dt>
              <dd className="font-semibold text-slate-950">
                {formatCurrency(vereador.totalEmpenhado)}
              </dd>
            </div>
          </dl>

          {vereador.pendencias ? (
            <Badge variant={palette.badge}>{vereador.pendencias} pendente(s)</Badge>
          ) : (
            <Badge variant="green">Todas pagas</Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function executionPalette(pct: number) {
  if (pct >= 75) {
    return {
      bar: "bg-gradient-to-r from-emerald-500 to-emerald-600",
      text: "text-emerald-700",
      badge: "green" as const,
    };
  }
  if (pct >= 40) {
    return {
      bar: "bg-gradient-to-r from-emerald-400 to-emerald-500",
      text: "text-emerald-700",
      badge: "blue" as const,
    };
  }
  if (pct >= 15) {
    return {
      bar: "bg-gradient-to-r from-amber-400 to-amber-500",
      text: "text-amber-700",
      badge: "amber" as const,
    };
  }
  return {
    bar: "bg-gradient-to-r from-rose-400 to-rose-500",
    text: "text-rose-700",
    badge: "red" as const,
  };
}
