import Image from "next/image";
import { AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { VereadorResumo } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/utils";

export function VereadorCard({ vereador }: { vereador: VereadorResumo }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
            <Image
              alt={`Foto de ${vereador.nome}`}
              className="object-cover object-top"
              fill
              sizes="56px"
              src={vereador.foto}
            />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-950">{vereador.nome}</h3>
            <p className="text-sm text-slate-500">
              {vereador.quantidadeEmendas} emenda(s)
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">Execucao</span>
            <strong className="text-slate-950">
              {formatPercent(vereador.percentualExecucao)}
            </strong>
          </div>
          <Progress value={vereador.percentualExecucao} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-slate-500">Autorizado</p>
            <p className="font-semibold text-slate-950">
              {formatCurrency(vereador.totalAutorizado)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Empenhado</p>
            <p className="font-semibold text-slate-950">
              {formatCurrency(vereador.totalEmpenhado)}
            </p>
          </div>
        </div>

        {vereador.pendencias ? (
          <Badge variant="amber">
            <AlertCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
            {vereador.pendencias} pendente(s)
          </Badge>
        ) : (
          <Badge variant="green">Todas pagas</Badge>
        )}
      </CardContent>
    </Card>
  );
}
