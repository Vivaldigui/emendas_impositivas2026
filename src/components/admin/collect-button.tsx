"use client";

import { Download, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type ColetaResultado = {
  ok?: boolean;
  status?: string;
  mensagem?: string;
  erro?: string | null;
  artifact?: {
    registrosImportados?: number;
    dbSync?: {
      novos?: number;
      atualizados?: number;
      inalterados?: number;
      totalDepois?: number;
    } | null;
  } | null;
};

export function CollectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function coletar() {
    setBusy(true);
    setIsError(false);
    setMessage("Coletando empenhos no Portal Cidadão... isso pode levar até 1 minuto.");
    try {
      const response = await fetch("/api/admin/coletas/empenhos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inicio: "2026-01-01", fim: "hoje", modo: "auto" }),
      });
      const payload = (await response.json().catch(() => ({}))) as ColetaResultado;

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.erro || payload.mensagem || "Falha na coleta.");
      }

      const sync = payload.artifact?.dbSync;
      const importados = payload.artifact?.registrosImportados ?? 0;
      setMessage(
        sync
          ? `Coleta concluída: ${importados} registro(s) lido(s). Banco: ${sync.novos ?? 0} novo(s), ${sync.atualizados ?? 0} alterado(s), ${sync.inalterados ?? 0} inalterado(s). Total: ${sync.totalDepois ?? 0}.`
          : `Coleta concluída: ${importados} registro(s) lido(s).`,
      );
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Falha na coleta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button disabled={busy} onClick={coletar} type="button" variant="primary">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        {busy ? "Coletando..." : "Coletar empenhos agora"}
      </Button>
      {message ? (
        <p
          className={`text-sm ${isError ? "text-rose-700" : "text-slate-700"}`}
          role="status"
        >
          {message}
        </p>
      ) : null}
      <p className="text-xs text-slate-500">
        A coleta lê os empenhos e atualiza o banco. A análise por IA é uma ação
        separada (no explorer abaixo), para você controlar o custo.
      </p>
    </div>
  );
}
