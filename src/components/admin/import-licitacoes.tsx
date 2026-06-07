"use client";

import { FileJson, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Resumo = { recebidas?: number; gravadas?: number; total?: number };

export function ImportLicitacoes({ total }: { total: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function enviar(texto: string) {
    setBusy(true);
    setIsError(false);
    setMessage("Importando licitações...");
    try {
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch {
        throw new Error("O conteúdo não é um JSON válido.");
      }

      const response = await fetch("/api/admin/licitacoes/importar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Falha ao importar.");
      }
      const resumo: Resumo = payload.resumo ?? {};
      setMessage(
        `Importadas ${resumo.gravadas ?? 0} licitação(ões). Total no banco: ${resumo.total ?? 0}.`,
      );
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Falha ao importar.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const texto = await file.text();
    await enviar(texto);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-50 text-violet-700">
          <FileJson className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h3 className="text-sm font-bold text-slate-950">Licitações (refino do casamento)</h3>
          <p className="text-xs text-slate-500">{total} licitação(ões) no banco</p>
        </div>
      </div>

      <input
        ref={inputRef}
        accept=".json,application/json"
        className="hidden"
        onChange={onFile}
        type="file"
      />
      <Button
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        type="button"
        variant="secondary"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="h-4 w-4" aria-hidden />
        )}
        Importar JSON de licitações
      </Button>

      {message ? (
        <p className={`text-sm ${isError ? "text-rose-700" : "text-slate-700"}`} role="status">
          {message}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-slate-500">
        Cole o relatório de licitações do Portal Cidadão num arquivo .json e envie aqui.
        O objeto de cada licitação enriquece o empenho de mesmo processo, melhorando o
        casamento com a emenda.
      </p>
    </div>
  );
}
