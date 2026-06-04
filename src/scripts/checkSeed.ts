import { emendas, vereadores } from "@/data/emendas";

const EXPECTED_TOTAL = 188367.61;
const byVereador = new Map<string, number>();

for (const emenda of emendas) {
  byVereador.set(
    emenda.vereadorId,
    Number(((byVereador.get(emenda.vereadorId) ?? 0) + emenda.valorAutorizado).toFixed(2)),
  );
}

if (vereadores.length !== 9) {
  throw new Error(`Esperado 9 vereadores, encontrado ${vereadores.length}.`);
}

for (const vereador of vereadores) {
  const total = byVereador.get(vereador.id) ?? 0;
  const diff = Math.abs(total - EXPECTED_TOTAL);

  if (diff > 0.011) {
    throw new Error(
      `Total de ${vereador.nome} deveria ser ${EXPECTED_TOTAL}, mas foi ${total}.`,
    );
  }
}

console.log("Seed de emendas validado.");
