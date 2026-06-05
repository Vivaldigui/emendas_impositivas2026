"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { EmendaResumo, VereadorResumo } from "@/lib/types";
import { formatCurrency, formatPercent, normalizeText } from "@/lib/utils";

const PAGE_SIZE = 18;

export function EmendasPublicList({
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const areas = useMemo(
    () => Array.from(new Set(emendas.map((item) => item.area))).sort(),
    [emendas],
  );

  // Para o público, achatamos "Conferir" em "Em execução" e nunca mostramos
  // "Parcial" como se fosse algo diferente — fica só "Em execução".
  const situacoesPublicas = useMemo(() => {
    const set = new Set<string>();
    for (const item of emendas) set.add(situacaoPublica(item));
    return Array.from(set).sort();
  }, [emendas]);

  const filtered = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    return emendas.filter((item) => {
      const haystack = normalizeText(
        [item.descricao, item.vereador.nome, item.area, item.secretaria, item.codigo].join(
          " ",
        ),
      );
      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        (!vereadorId || item.vereadorId === vereadorId) &&
        (!area || item.area === area) &&
        (!situacao || situacaoPublica(item) === situacao)
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
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Buscar por descrição, secretaria ou código"
              value={query}
            />
          </label>
          <SelectFilter
            label="Vereador"
            onChange={(value) => {
              setVereadorId(value);
              setVisibleCount(PAGE_SIZE);
            }}
            options={vereadores.map((vereador) => ({
              label: vereador.nome,
              value: vereador.id,
            }))}
            value={vereadorId}
          />
          <SelectFilter
            label="Área"
            onChange={(value) => {
              setArea(value);
              setVisibleCount(PAGE_SIZE);
            }}
            options={areas.map((value) => ({ label: value, value }))}
            value={area}
          />
          <SelectFilter
            label="Situação"
            onChange={(value) => {
              setSituacao(value);
              setVisibleCount(PAGE_SIZE);
            }}
            options={situacoesPublicas.map((value) => ({ label: value, value }))}
            value={situacao}
          />
        </div>

        <p className="text-sm text-slate-600">
          Exibindo {visibleRows.length} de {filtered.length} emenda(s).
        </p>

        <ul className="space-y-2">
          {visibleRows.map((item) => {
            const situacaoPub = situacaoPublica(item);
            return (
              <li key={item.id}>
                <Link
                  className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-emerald-300 hover:shadow-sm"
                  href={`/emendas/${item.id}`}
                >
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-950">
                        {item.descricao}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.vereador.nome} • {item.area} • {item.secretaria}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-left sm:text-right">
                      <div>
                        <p className="text-sm font-bold text-slate-950">
                          {formatCurrency(item.valorAutorizado)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatPercent(item.percentualExecucao)} executado
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Badge variant={situacaoVariant(situacaoPub)}>{situacaoPub}</Badge>
                    <Progress className="flex-1" value={item.percentualExecucao} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {visibleRows.length < filtered.length ? (
          <div className="flex justify-center">
            <Button
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
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

// Mapeia a situação técnica em algo legível para o público.
// "Conferir" e "Parcial" viram "Em execução".
function situacaoPublica(item: EmendaResumo): string {
  if (item.situacao === "Paga") return "Paga";
  if (item.situacao === "Liquidada") return "Liquidada";
  if (item.situacao === "Aguardando empenho") return "Aguardando empenho";
  return "Em execução";
}

function situacaoVariant(situacao: string) {
  if (situacao === "Paga" || situacao === "Liquidada") return "green";
  if (situacao === "Aguardando empenho") return "amber";
  return "blue";
}
