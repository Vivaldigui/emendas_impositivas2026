import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { emendas, vereadores } from "../src/data/emendas";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL nao configurada.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const vereador of vereadores) {
    await prisma.vereador.upsert({
      where: { id: vereador.id },
      create: {
        id: vereador.id,
        nome: vereador.nome,
        nomeCurto: vereador.nomeCurto,
        partido: vereador.partido ?? null,
        foto: vereador.foto,
      },
      update: {
        nome: vereador.nome,
        nomeCurto: vereador.nomeCurto,
        partido: vereador.partido ?? null,
        foto: vereador.foto,
      },
    });
  }

  for (const emenda of emendas) {
    await prisma.emenda.upsert({
      where: { id: emenda.id },
      create: {
        id: emenda.id,
        vereadorId: emenda.vereadorId,
        descricao: emenda.descricao,
        valorAutorizado: emenda.valorAutorizado,
        area: emenda.area,
        secretaria: emenda.secretaria,
        codigo: emenda.codigo,
        acao: emenda.acao,
        dotacao: emenda.dotacao,
        fonteDocumento: emenda.fonteDocumentoId,
      },
      update: {
        vereadorId: emenda.vereadorId,
        descricao: emenda.descricao,
        valorAutorizado: emenda.valorAutorizado,
        area: emenda.area,
        secretaria: emenda.secretaria,
        codigo: emenda.codigo,
        acao: emenda.acao,
        dotacao: emenda.dotacao,
        fonteDocumento: emenda.fonteDocumentoId,
      },
    });
  }

  const totalVereadores = await prisma.vereador.count();
  const totalEmendas = await prisma.emenda.count();

  console.log(`Seed concluido: ${totalVereadores} vereadores e ${totalEmendas} emendas.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
