"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EmendaResumo, VereadorResumo } from "@/lib/types";
import { formatCurrency, formatPercent, normalizeText } from "@/lib/utils";

export function EmendasExplorer({
  emendas,
  vereadores,
}: {
  emendas: EmendaResumo[];
  vereadores: VereadorResumo[];
}) {
  const [query, setQuery] = useState("");
  const [vereadorId, setVereadorId] = useState("");
  const [area, setArea] = useState("");
  const [situacao, setSituacao] = useState("");
  const [visibleCount, setVisibleCount] = useState(18);
  const areas = useMemo(
    () => Array.from(new Set(emendas.map((item) => item.area))).sort(),
    [emendas],
  );
  const situacoes = useMemo(
    () => Array.from(new Set(emendas.map((item) => item.situacao))).sort(),
    [emendas],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return emendas.filter((item) => {
      const haystack = normalizeText(
        [item.descricao, item.vereador.nome, item.area, item.secretaria, item.codigo].join(" "),
      );

      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        (!vereadorId || item.vereadorId === vereadorId) &&
        (!area || item.area === area) &&
        (!situacao || item.situacao === situacao)
      );
    });
  }, [area, emendas, query, situacao, vereadorId]);

  const visibleRows = filtered.slice(0, visibleCount);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Pesquisar</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-600"
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(18);
              }}
              placeholder="Buscar por descricao, secretaria ou codigo"
              value={query}
            />
          </label>
          <SelectFilter
            label="Vereador"
            onChange={(value) => {
              setVereadorId(value);
              setVisibleCount(18);
            }}
            options={vereadores.map((vereador) => ({
              label: vereador.nome,
              value: vereador.id,
            }))}
            value={vereadorId}
          />
          <SelectFilter
            label="Area"
            onChange={(value) => {
              setArea(value);
              setVisibleCount(18);
            }}
            options={areas.map((value) => ({ label: value, value }))}
            value={area}
          />
          <SelectFilter
            label="Situacao"
            onChange={(value) => {
              setSituacao(value);
              setVisibleCount(18);
            }}
            options={situacoes.map((value) => ({ label: value, value }))}
            value={situacao}
          />
        </div>

        <p className="text-sm text-slate-600">
          Exibindo {visibleRows.length} de {filtered.length} emenda(s).
        </p>

        <div className="space-y-3">
          {visibleRows.map((item) => (
            <details
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 open:bg-white"
              key={item.id}
            >
              <summary className="grid cursor-pointer gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-950">{item.descricao}</h3>
                    <Badge variant={badgeVariant(item.situacao)}>{item.situacao}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.vereador.nome} · {item.area} · {item.secretaria}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-bold text-slate-950">
                    {formatCurrency(item.valorAutorizado)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPercent(item.percentualExecucao)} empenhado
                  </p>
                </div>
              </summary>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
                <Metric label="Empenhado" value={formatCurrency(item.valorEmpenhado)} />
                <Metric label="Liquidado" value={formatCurrency(item.valorLiquidado)} />
                <Metric label="Pago" value={formatCurrency(item.valorPago)} />
                <Metric label="Saldo" value={formatCurrency(item.saldo)} />
              </div>

              <div className="mt-4 rounded-md bg-white p-3 text-sm text-slate-700">
                {item.vinculos.length ? (
                  <div className="space-y-2">
                    {item.vinculos.map((vinculo) => (
                      <div
                        className="border-b border-slate-100 pb-2 last:border-0 last:pb-0"
                        key={`${vinculo.emendaId}-${vinculo.empenhoId}`}
                      >
                        <p className="font-semibold text-slate-900">
                          Empenho {vinculo.empenho.numeroEmpenho ?? "sem numero"} ·{" "}
                          {formatCurrency(vinculo.empenho.valorEmpenhado)}
                        </p>
                        <p>{vinculo.empenho.historico ?? "Historico nao localizado"}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {vinculo.criterio} · confianca {Math.round(vinculo.confianca * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>Nenhum empenho vinculado nos arquivos importados.</p>
                )}
              </div>
            </details>
          ))}
        </div>

        {visibleRows.length < filtered.length ? (
          <div className="flex justify-center">
            <Button
              onClick={() => setVisibleCount((current) => current + 18)}
              type="button"
              variant="secondary"
            >
              Mostrar mais emendas
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SelectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-44 text-sm font-medium text-slate-700">
      <span className="sr-only">{label}</span>
      <select
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-600"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-950">{value}</p>
    </div>
  );
}

function badgeVariant(situacao: string) {
  if (situacao === "Paga" || situacao === "Liquidada") {
    return "green";
  }

  if (situacao === "Conferir") {
    return "red";
  }

  if (situacao === "Aguardando empenho") {
    return "amber";
  }

  return "blue";
}
