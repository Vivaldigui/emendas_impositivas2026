import { Check, Circle, FileSignature, FileText, Landmark, Wallet } from "lucide-react";

import { formatCurrency } from "@/lib/utils";

type TimelineProps = {
  valorAutorizado: number;
  valorEmpenhado: number;
  valorLiquidado: number;
  valorPago: number;
};

const STAGES = [
  {
    key: "autorizado",
    label: "Autorizado",
    descricao: "Valor previsto na emenda impositiva, garantido por lei.",
    icon: FileSignature,
  },
  {
    key: "empenhado",
    label: "Empenhado",
    descricao: "Prefeitura reservou o dinheiro para um fornecedor ou entidade.",
    icon: FileText,
  },
  {
    key: "liquidado",
    label: "Liquidado",
    descricao: "Bem/serviço foi entregue e a despesa foi reconhecida.",
    icon: Landmark,
  },
  {
    key: "pago",
    label: "Pago",
    descricao: "Dinheiro saiu de fato do caixa para o beneficiário.",
    icon: Wallet,
  },
] as const;

export function TimelineExecucao({
  valorAutorizado,
  valorEmpenhado,
  valorLiquidado,
  valorPago,
}: TimelineProps) {
  const valores = {
    autorizado: valorAutorizado,
    empenhado: valorEmpenhado,
    liquidado: valorLiquidado,
    pago: valorPago,
  };

  return (
    <ol className="grid gap-3 sm:grid-cols-4">
      {STAGES.map((stage) => {
        const valor = valores[stage.key];
        const concluido = valor > 0;
        const Icon = stage.icon;
        return (
          <li
            key={stage.key}
            className={
              concluido
                ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                : "rounded-lg border border-slate-200 bg-white p-3"
            }
          >
            <div className="flex items-center gap-2">
              <span
                className={
                  concluido
                    ? "flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white"
                    : "flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                }
              >
                {concluido ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Icon className="h-4 w-4" aria-hidden />
                )}
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {stage.label}
                </p>
                <p className="text-sm font-bold text-slate-950">{formatCurrency(valor)}</p>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{stage.descricao}</p>
            {!concluido ? (
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <Circle className="h-3 w-3" aria-hidden />
                Ainda não chegou nesta etapa
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
