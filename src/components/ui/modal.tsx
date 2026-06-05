"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};

export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-950">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
            ) : null}
          </div>
          <Button
            aria-label="Fechar"
            className="h-8 w-8 p-0"
            onClick={onClose}
            type="button"
            variant="subtle"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        {children ? <div className="space-y-3 px-5 py-4 text-sm">{children}</div> : null}
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
