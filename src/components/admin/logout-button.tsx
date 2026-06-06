"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LogoutButton({ nome }: { nome: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sair() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-600">
        Logado como <strong className="text-slate-900">{nome}</strong>
      </span>
      <Button disabled={busy} onClick={sair} type="button" variant="subtle">
        <LogOut className="h-4 w-4" aria-hidden />
        Sair
      </Button>
    </div>
  );
}
