"use client";

import { Landmark, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function AdminLogin() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usuario: usuario.trim(), senha }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao entrar.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
      <Card className="w-full">
        <CardContent className="space-y-5">
          <div className="space-y-1 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Landmark className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="text-xl font-bold text-slate-950">Painel administrativo</h1>
            <p className="text-sm text-slate-600">
              Acesso restrito à equipe da Câmara de Itanhandu.
            </p>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Usuário</span>
              <input
                autoFocus
                className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                onChange={(event) => setUsuario(event.target.value)}
                placeholder="seu.usuario"
                type="text"
                value={usuario}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Senha</span>
              <input
                className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                onChange={(event) => setSenha(event.target.value)}
                placeholder="••••••••"
                type="password"
                value={senha}
              />
            </label>

            {error ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            ) : null}

            <Button className="w-full" disabled={busy} type="submit" variant="primary">
              <LogIn className="h-4 w-4" aria-hidden />
              {busy ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
