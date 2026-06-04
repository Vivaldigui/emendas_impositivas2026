import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Emendas Impositivas de Itanhandu",
  description:
    "Dashboard de acompanhamento das emendas impositivas municipais e seus empenhos oficiais.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
