"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function ShareButton({
  title,
  text,
}: {
  title: string;
  text?: string;
}) {
  const [done, setDone] = useState<"copied" | "shared" | null>(null);

  async function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url });
        setDone("shared");
        setTimeout(() => setDone(null), 1500);
        return;
      } catch {
        // usuário cancelou ou navegador não suporta; cai pro fallback
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setDone("copied");
        setTimeout(() => setDone(null), 1800);
      } catch {
        window.prompt("Copie o link da emenda:", url);
      }
    } else if (typeof window !== "undefined") {
      window.prompt("Copie o link da emenda:", url);
    }
  }

  return (
    <Button onClick={handleShare} type="button" variant="secondary">
      {done === "copied" ? (
        <>
          <Check className="h-4 w-4" aria-hidden /> Link copiado
        </>
      ) : done === "shared" ? (
        <>
          <Check className="h-4 w-4" aria-hidden /> Compartilhado
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" aria-hidden /> Compartilhar
        </>
      )}
    </Button>
  );
}
