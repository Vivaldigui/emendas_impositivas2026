"use client";

import {
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  Eye,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EmendaResumo, VereadorResumo } from "@/lib/types";
import { formatCurrency, formatDate, formatPercent, normalizeText } from "@/lib/utils";

type AiStatus = {
  enabled: boolean;
  available: boolean;
  model: string;
};

type ReviewModalState =
  | { type: "CONFIRMAR"; vinculo: EmendaResumo["vinculos"][number] }
  | { type: "REJEITAR"; vinculo: EmendaResumo["vinculos"][number] }
  | { type: "DESFAZER_CONFIRMACAO"; vinculo: EmendaResumo["vinculos"][number] }
  | { type: "ALTERAR_VALOR"; vinculo: EmendaResumo["vinculos"][number] }
  | null;

export function EmendasExplorer({
  emendas,
  vereadores,
  ia,
}: {
  emendas: EmendaResumo[];
  vereadores: VereadorResumo[];
  ia: AiStatus;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [vereadorId, setVereadorId] = useState("");
  const [area, setArea] = useState("");
  const [situacao, setSituacao] = useState("");
  const [visibleCount, setVisibleCount] = useState(18);
  const [adminSecret, setAdminSecret] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewModal, setReviewModal] = useState<ReviewModalState>(null);
  const [reviewJustificativa, setReviewJustificativa] = useState("");
  const [reviewValor, setReviewValor] = useState("");
  const [reviewPermitirExcedente, setReviewPermitirExcedente] = useState(false);

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
        [
          item.descricao,
          item.vereador.nome,
          item.area,
          item.secretaria,
          item.codigo,
          item.analiseIa?.justificativa,
        ].join(" "),
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

  function openReviewModal(
    vinculo: EmendaResumo["vinculos"][number],
    type: NonNullable<ReviewModalState>["type"],
  ) {
    if (!vinculo.id) {
      setMessage("Somente sugestões persistidas podem ser revisadas.");
      return;
    }
    setReviewJustificativa("");
    setReviewValor(
      String(vinculo.valorAtribuido ?? vinculo.empenho?.valorEmpenhado ?? 0),
    );
    setReviewPermitirExcedente(false);
    setReviewModal({ type, vinculo } as ReviewModalState);
  }

  function closeReviewModal() {
    setReviewModal(null);
    setReviewJustificativa("");
    setReviewValor("");
    setReviewPermitirExcedente(false);
  }

  async function analyze(options: { emendaIds?: string[]; reanalisar?: boolean }) {
    if (!adminSecret.trim()) {
      setMessage("Informe o segredo admin antes de executar a análise por IA.");
      return;
    }

    setBusyAction(options.emendaIds?.[0] ?? "all");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/ia/vincular-empenhos", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-secret": adminSecret.trim(),
        },
        body: JSON.stringify(options),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(formatApiError(payload.error ?? "Falha ao executar análise."));
      }

      if (payload.ok === false) {
        throw new Error(formatBatchError(payload));
      }

      setMessage(
        `Análise concluída: ${payload.resumo.analisadas} emenda(s), ${payload.resumo.sugeridas} sugestão(ões), ${payload.resumo.conferir} para conferir.`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao executar análise.");
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReview() {
    if (!reviewModal) return;
    const { type, vinculo } = reviewModal;
    const body: {
      acao: typeof type;
      valorAtribuido?: number | null;
      justificativa?: string | null;
      permitirExcedente?: boolean;
    } = { acao: type };

    if (type === "REJEITAR" || type === "DESFAZER_CONFIRMACAO") {
      if (!reviewJustificativa.trim()) {
        setMessage("Justificativa obrigatória para esta ação.");
        return;
      }
      body.justificativa = reviewJustificativa.trim();
    }

    if (type === "ALTERAR_VALOR") {
      const parsedValue = Number(reviewValor.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        setMessage("Valor atribuído inválido.");
        return;
      }
      body.valorAtribuido = parsedValue;
      body.justificativa = reviewJustificativa.trim() || null;
      body.permitirExcedente = reviewPermitirExcedente;
    }

    if (!adminSecret.trim()) {
      setMessage("Informe o segredo admin antes de revisar vínculos.");
      return;
    }

    setBusyAction(vinculo.id ?? "review");
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/ia/vinculos/${vinculo.id}/revisar`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-secret": adminSecret.trim(),
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(formatApiError(payload.error ?? "Falha ao revisar vínculo."));
      }

      setMessage("Revisão registrada com auditoria.");
      closeReviewModal();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao revisar vínculo.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-start">
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
                placeholder="Buscar por descrição, secretaria, código ou justificativa"
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
              label="Área"
              onChange={(value) => {
                setArea(value);
                setVisibleCount(18);
              }}
              options={areas.map((value) => ({ label: value, value }))}
              value={area}
            />
            <SelectFilter
              label="Situação"
              onChange={(value) => {
                setSituacao(value);
                setVisibleCount(18);
              }}
              options={situacoes.map((value) => ({ label: value, value }))}
              value={situacao}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] xl:w-[29rem]">
            <label>
              <span className="sr-only">Segredo admin</span>
              <input
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                onChange={(event) => setAdminSecret(event.target.value)}
                placeholder="Segredo admin para revisar"
                type="password"
                value={adminSecret}
              />
            </label>
            <Button
              disabled={busyAction !== null}
              onClick={() => analyze({})}
              type="button"
              variant="secondary"
            >
              <BrainCircuit className="h-4 w-4" aria-hidden />
              Analisar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Exibindo {visibleRows.length} de {filtered.length} emenda(s).</span>
          {ia.available ? (
            <Badge variant="green">IA disponível • {ia.model}</Badge>
          ) : (
            <Badge variant="amber">Análise de IA indisponível</Badge>
          )}
          {!ia.enabled ? <Badge variant="neutral">IA desativada</Badge> : null}
          {message ? <span className="font-medium text-slate-800">{message}</span> : null}
        </div>

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
                    {statusBadges(item).map((badge) => (
                      <Badge key={badge.label} variant={badge.variant}>
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.vereador.nome} • {item.area} • {item.secretaria}
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

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  href={`/emendas/${item.id}`}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  Abrir página pública
                </Link>
                <Button
                  disabled={busyAction !== null}
                  onClick={() => analyze({ emendaIds: [item.id], reanalisar: true })}
                  type="button"
                  variant="secondary"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Analisar novamente
                </Button>
              </div>

              {item.analiseIa ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-950">
                    Última análise: {analysisLabel(item.analiseIa.resultadoGeral)}
                  </p>
                  <p className="mt-1">
                    {item.analiseIa.justificativa ?? "Justificativa não registrada."}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.analiseIa.modelo ?? "sem modelo"} •{" "}
                    {formatDate(item.analiseIa.dataAnalise)} • candidatos:{" "}
                    {item.analiseIa.quantidadeCandidatos}
                  </p>
                </div>
              ) : null}

              <div className="mt-4 rounded-md bg-white p-3 text-sm text-slate-700">
                {item.vinculos.length ? (
                  <div className="space-y-3">
                    {item.vinculos.map((vinculo) => (
                      <div
                        className="rounded-md border border-slate-200 p-3"
                        key={`${vinculo.emendaId}-${vinculo.empenhoId}-${vinculo.id ?? "regra"}`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-900">
                                Empenho {vinculo.empenho.numeroEmpenho ?? "sem número"}
                              </p>
                              <Badge variant={vinculoBadgeVariant(vinculo)}>
                                {vinculoBadgeLabel(vinculo)}
                              </Badge>
                            </div>
                            <p>
                              <strong>Favorecido:</strong>{" "}
                              {vinculo.empenho.fornecedor ?? "não localizado"}
                            </p>
                            <p className="text-slate-600">
                              {vinculo.justificativaCurta ||
                                vinculo.observacao ||
                                vinculo.empenho.historico ||
                                "Histórico não localizado"}
                            </p>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-80">
                            <MiniMetric
                              label="Valor empenho"
                              value={formatCurrency(vinculo.empenho.valorEmpenhado)}
                            />
                            <MiniMetric
                              label="Valor atribuído"
                              value={
                                vinculo.valorAtribuido !== null &&
                                vinculo.valorAtribuido !== undefined
                                  ? formatCurrency(vinculo.valorAtribuido)
                                  : "a conferir"
                              }
                            />
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                          <Info label="Ação/Dotação" value={vinculo.empenho.dotacao ?? item.acao} />
                          <Info label="Secretaria" value={vinculo.empenho.secretaria ?? item.secretaria} />
                          <Info label="Natureza" value={vinculo.empenho.naturezaDespesa} />
                          <Info
                            label="Score/IA"
                            value={`${Math.round((vinculo.scoreDeterministico ?? 0) * 100)}% regra / ${
                              vinculo.confianca !== null && vinculo.confianca !== undefined
                                ? `${Math.round(vinculo.confianca * 100)}% IA`
                                : "sem IA"
                            }`}
                          />
                        </div>

                        <details className="mt-3 rounded-md bg-slate-50 p-3">
                          <summary className="inline-flex cursor-pointer items-center gap-2 font-semibold text-slate-800">
                            <Eye className="h-4 w-4" aria-hidden />
                            Ver detalhes
                          </summary>
                          <div className="mt-3 space-y-2">
                            <Info label="Fonte/Modalidade" value={vinculo.empenho.fonteRecurso ?? vinculo.empenho.modalidadeAplicacao} />
                            <Info label="Processo" value={vinculo.empenho.processoCompra} />
                            <Info label="Histórico" value={vinculo.empenho.historico} />
                            <Info label="Modelo" value={vinculo.modelo} />
                            <Info label="Data da análise" value={formatDate(vinculo.atualizadoEm)} />
                            <List label="Critérios encontrados" values={vinculo.criterios} />
                            <List label="Divergências" values={vinculo.divergencias} />
                            <List label="Campos usados" values={vinculo.camposUsados} />
                          </div>
                        </details>

                        {vinculo.id ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              disabled={busyAction !== null}
                              onClick={() => openReviewModal(vinculo, "CONFIRMAR")}
                              type="button"
                              variant="secondary"
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden />
                              Confirmar
                            </Button>
                            <Button
                              disabled={busyAction !== null}
                              onClick={() => openReviewModal(vinculo, "REJEITAR")}
                              type="button"
                              variant="secondary"
                            >
                              <XCircle className="h-4 w-4" aria-hidden />
                              Rejeitar
                            </Button>
                            <Button
                              disabled={busyAction !== null}
                              onClick={() => openReviewModal(vinculo, "ALTERAR_VALOR")}
                              type="button"
                              variant="secondary"
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                              Editar valor atribuído
                            </Button>
                            {vinculo.decisao === "CONFIRMADO" ? (
                              <Button
                                disabled={busyAction !== null}
                                onClick={() => openReviewModal(vinculo, "DESFAZER_CONFIRMACAO")}
                                type="button"
                                variant="secondary"
                              >
                                <ShieldCheck className="h-4 w-4" aria-hidden />
                                Desfazer confirmação
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>
                    {item.analiseIa?.resultadoGeral === "SEM_VINCULO"
                      ? "Sem vínculo localizado na última análise."
                      : "Nenhum empenho vinculado nos arquivos importados."}
                  </p>
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

      <Modal
        open={reviewModal !== null}
        onClose={closeReviewModal}
        title={modalTitle(reviewModal?.type)}
        description={modalDescription(reviewModal?.type)}
        footer={
          <>
            <Button onClick={closeReviewModal} type="button" variant="subtle">
              Cancelar
            </Button>
            <Button
              disabled={busyAction !== null}
              onClick={submitReview}
              type="button"
              variant="primary"
            >
              {modalConfirmLabel(reviewModal?.type)}
            </Button>
          </>
        }
      >
        {reviewModal?.type === "ALTERAR_VALOR" ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Novo valor atribuído (R$)
            </span>
            <input
              className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-600"
              onChange={(event) => setReviewValor(event.target.value)}
              placeholder="0,00"
              type="text"
              value={reviewValor}
            />
          </label>
        ) : null}

        {reviewModal?.type === "ALTERAR_VALOR" ||
        reviewModal?.type === "REJEITAR" ||
        reviewModal?.type === "DESFAZER_CONFIRMACAO" ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Justificativa
              {reviewModal?.type !== "ALTERAR_VALOR" ? " (obrigatória)" : " (opcional)"}
            </span>
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              onChange={(event) => setReviewJustificativa(event.target.value)}
              placeholder="Descreva o motivo da revisão para o histórico de auditoria."
              value={reviewJustificativa}
            />
          </label>
        ) : null}

        {reviewModal?.type === "ALTERAR_VALOR" ? (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              checked={reviewPermitirExcedente}
              onChange={(event) => setReviewPermitirExcedente(event.target.checked)}
              type="checkbox"
            />
            Permitir valor acima do saldo (somente com justificativa documental).
          </label>
        ) : null}
      </Modal>
    </Card>
  );
}

function modalTitle(type?: NonNullable<ReviewModalState>["type"]) {
  if (type === "CONFIRMAR") return "Confirmar vínculo";
  if (type === "REJEITAR") return "Rejeitar sugestão";
  if (type === "ALTERAR_VALOR") return "Editar valor atribuído";
  if (type === "DESFAZER_CONFIRMACAO") return "Desfazer confirmação";
  return "";
}

function modalDescription(type?: NonNullable<ReviewModalState>["type"]) {
  if (type === "CONFIRMAR")
    return "Esta correspondência é uma sugestão automatizada e deve ser conferida com os documentos orçamentários.";
  if (type === "REJEITAR")
    return "A rejeição fica registrada com seu nome e a justificativa abaixo no histórico de auditoria.";
  if (type === "ALTERAR_VALOR")
    return "Use apenas valores documentalmente comprovados.";
  if (type === "DESFAZER_CONFIRMACAO")
    return "Reabrir um vínculo já confirmado também é registrado no histórico de auditoria.";
  return "";
}

function modalConfirmLabel(type?: NonNullable<ReviewModalState>["type"]) {
  if (type === "CONFIRMAR") return "Confirmar";
  if (type === "REJEITAR") return "Rejeitar";
  if (type === "ALTERAR_VALOR") return "Salvar valor";
  if (type === "DESFAZER_CONFIRMACAO") return "Desfazer";
  return "OK";
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-950">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <p>
      <strong>{label}:</strong> {value || "não localizado"}
    </p>
  );
}

function List({ label, values }: { label: string; values?: string[] }) {
  return (
    <div>
      <p className="font-semibold text-slate-800">{label}</p>
      {values?.length ? (
        <ul className="mt-1 flex flex-wrap gap-1">
          {values.map((value) => (
            <li
              className="rounded-full bg-white px-2 py-1 text-xs text-slate-700"
              key={`${label}-${value}`}
            >
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">Nada registrado.</p>
      )}
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

function statusBadges(item: EmendaResumo) {
  const badges: Array<{ label: string; variant: "neutral" | "blue" | "green" | "amber" | "red" }> = [];
  const decisions = new Set(item.vinculos.map((vinculo) => vinculo.decisao));
  const origins = new Set(item.vinculos.map((vinculo) => vinculo.origem));

  if (origins.has("REGRA")) {
    badges.push({ label: "Correspondência por regra", variant: "blue" });
  }
  if (origins.has("IA") && decisions.has("SUGERIDO")) {
    badges.push({ label: "IA sugeriu", variant: "blue" });
  }
  if (decisions.has("CONFERIR")) {
    badges.push({ label: "Conferir manualmente", variant: "amber" });
  }
  if (decisions.has("CONFIRMADO")) {
    badges.push({ label: "Confirmado", variant: "green" });
  }
  if (decisions.has("REJEITADO")) {
    badges.push({ label: "Rejeitado", variant: "red" });
  }
  if (item.analiseIa?.resultadoGeral === "SEM_VINCULO") {
    badges.push({ label: "Sem vínculo localizado", variant: "neutral" });
  }

  return badges;
}

function vinculoBadgeLabel(vinculo: EmendaResumo["vinculos"][number]) {
  if (vinculo.decisao === "CONFIRMADO") {
    return "Confirmado";
  }
  if (vinculo.decisao === "REJEITADO") {
    return "Rejeitado";
  }
  if (vinculo.decisao === "CONFERIR") {
    return "Conferir manualmente";
  }
  if (vinculo.origem === "IA") {
    return "IA sugeriu";
  }
  return "Correspondência por regra";
}

function vinculoBadgeVariant(
  vinculo: EmendaResumo["vinculos"][number],
): "neutral" | "blue" | "green" | "amber" | "red" {
  if (vinculo.decisao === "CONFIRMADO") {
    return "green";
  }
  if (vinculo.decisao === "REJEITADO") {
    return "red";
  }
  if (vinculo.decisao === "CONFERIR") {
    return "amber";
  }
  return "blue";
}

function analysisLabel(resultado: string) {
  if (resultado === "SUGERIR_VINCULOS") {
    return "Sugeriu vínculos";
  }
  if (resultado === "CONFERIR") {
    return "Conferir manualmente";
  }
  if (resultado === "SEM_VINCULO") {
    return "Sem vínculo localizado";
  }
  return "Erro na análise";
}

function formatApiError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("nao autorizado") || normalized.includes("não autorizado")) {
    return "Nao autorizado. Confira o segredo admin informado.";
  }

  if (
    normalized.includes("rate exceeded") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("quota")
  ) {
    return "Limite temporario da OpenAI atingido. Aguarde alguns minutos e tente novamente, preferencialmente em uma emenda por vez.";
  }

  return message;
}

function formatBatchError(payload: {
  resumo?: { erros?: number };
  resultados?: Array<{ erro?: string }>;
}) {
  const firstError = payload.resultados?.find((result) => result.erro)?.erro;
  const errorCount = payload.resumo?.erros ?? 0;
  const formatted = firstError ? formatApiError(firstError) : null;

  return formatted
    ? `Analise finalizada com ${errorCount} erro(s): ${formatted}`
    : `Analise finalizada com ${errorCount} erro(s). Confira o historico de analises.`;
}
