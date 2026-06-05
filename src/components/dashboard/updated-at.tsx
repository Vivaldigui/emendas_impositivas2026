"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

export function UpdatedAt({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => formatRelative(iso));

  useEffect(() => {
    const interval = setInterval(() => setLabel(formatRelative(iso)), 30_000);
    return () => clearInterval(interval);
  }, [iso]);

  return (
    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      Atualizado {label}
    </p>
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 30) return "agora";
  if (diffSec < 90) return "há menos de 1 minuto";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `há ${mins} minutos`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours} hora(s)`;
  const days = Math.round(hours / 24);
  return `há ${days} dia(s)`;
}
