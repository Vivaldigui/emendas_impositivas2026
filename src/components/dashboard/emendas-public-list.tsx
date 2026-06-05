"use client";

import { ChevronRight, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { EmendaResumo, VereadorResumo } from "@/lib/types";
import { formatCurrency, formatPercent, normalizeText } from "@/lib/utils";

const PAGE_SIZE = 18;

type SortKey = "execucao_desc" | "execucao_asc" | "valor_desc" | "alfabetica";

const SORT_LABELS: Record<SortKey, string> = {
  execucao_desc: "Mais executadas primeiro",
  execucao_asc: "Menos executadas primeiro",
  valor_desc: "Maior valor primeiro",
  alfabetica: "Ordem alfabética",
};

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
  const [sort, setSort] = useState<SortKey>("execucao_desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const areas = useMemo(
    () => Array.from(new Set(emendas.map((item) => item.area))).sort(),
    [emendas],
  );

  // Contagem por situação para mostrar nos chips.
  const situacaoBuckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of emendas) {
      const key = situacaoPublica(item);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
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

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === "execucao_desc") {
      list.sort((a, b) => b.percentualExecucao - a.percentualExecucao);
    } else if (sort === "execucao_asc") {
      list.sort((a, b) => a.percentualExecucao - b.percentualExecucao);
    } else if (sort === "valor_desc") {
      list.sort((a, b) => b.valorAutorizado - a.valorAutorizado);
    } else {
      list.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
    }
    return list;
  }, [filtered, sort]);

  const visibleRows = sorted.slice(0, visibleCount);
  const hasFilters = Boolean(query || vereadorId || area || situacao);

  function clearFilters() {
    setQuery("");
    setVereadorId("");
    setArea("");
    setSituacao("");
    setVisibleCount(PAGE_SIZE);
  }

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
              className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Buscar por descrição, vereador, secretaria ou código"
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
        </div>

        {/* Chips de situação como filtro rápido + ordenação */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            active={situacao === ""}
            onClick={() => {
              setSituacao("");
              setVisibleCount(PAGE_SIZE);
            }}
          >
            Todas ({emendas.length})
          </Chip>
          {situacaoBuckets.map(([label, count]) => (
            <Chip
              key={label}
              active={situacao === label}
              onClick={() => {
                setSituacao(label === situacao ? "" : label);
                setVisibleCount(PAGE_SIZE);
              }}
              tone={chipTone(label)}
            >
              {label} ({count})
            </Chip>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {hasFilters ? (
              <Button onClick={clearFilters} type="button" variant="subtle">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Limpar filtros
              </Button>
            ) : null}
            <select
              aria-label="Ordenação"
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-emerald-600"
              onChange={(event) => setSort(event.target.value as SortKey)}
              value={sort}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-sm text-slate-600">
          Exibindo {visibleRows.length} de {sorted.length} emenda(s).
        </p>

        <ul className="space-y-2">
          {visibleRows.map((item) => {
            const situacaoPub = situacaoPublica(item);
            return (
              <li key={item.id}>
                <Link
                  className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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
          {sorted.length === 0 ? (
            <li className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
              Nenhuma emenda atende a esses filtros.
              {hasFilters ? (
                <>
                  {" "}
                  <button
                    className="font-semibold text-emerald-700 hover:underline"
                    onClick={clearFilters}
                    type="button"
                  >
                    Limpar filtros
                  </button>
                </>
              ) : null}
            </li>
          ) : null}
        </ul>

        {visibleRows.length < sorted.length ? (
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
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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

type ChipTone = "neutral" | "green" | "amber" | "blue";

function Chip({
  active,
  onClick,
  tone = "neutral",
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: ChipTone;
  children: React.ReactNode;
}) {
  const tones: Record<ChipTone, string> = {
    neutral: active
      ? "bg-slate-900 text-white border-slate-900"
      : "bg-white text-slate-700 border-slate-200 hover:border-slate-400",
    green: active
      ? "bg-emerald-600 text-white border-emerald-600"
      : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:border-emerald-400",
    amber: active
      ? "bg-amber-600 text-white border-amber-600"
      : "bg-amber-50 text-amber-800 border-amber-200 hover:border-amber-400",
    blue: active
      ? "bg-sky-700 text-white border-sky-700"
      : "bg-sky-50 text-sky-800 border-sky-200 hover:border-sky-400",
  };
  return (
    <button
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition ${tones[tone]}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function chipTone(situacao: string): ChipTone {
  if (situacao === "Paga" || situacao === "Liquidada") return "green";
  if (situacao === "Aguardando empenho") return "amber";
  if (situacao === "Em execução") return "blue";
  return "neutral";
}

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
