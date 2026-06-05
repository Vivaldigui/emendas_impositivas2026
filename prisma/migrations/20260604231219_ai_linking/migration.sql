/*
  Warnings:

  - Added the required column `atualizadoEm` to the `EmendaEmpenhoVinculo` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "EmendaEmpenhoVinculo" ADD COLUMN     "atualizadoEm" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "camposUsados" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "criterios" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "decisao" TEXT NOT NULL DEFAULT 'SUGERIDO',
ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "justificativaCurta" TEXT,
ADD COLUMN     "modelo" TEXT,
ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'REGRA',
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "revisadoEm" TIMESTAMP(3),
ADD COLUMN     "revisadoPor" TEXT,
ADD COLUMN     "valorAtribuido" DECIMAL(16,2),
ALTER COLUMN "confianca" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AnaliseIaEmenda" (
    "id" TEXT NOT NULL,
    "emendaId" TEXT NOT NULL,
    "resultadoGeral" TEXT NOT NULL,
    "dataAnalise" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelo" TEXT,
    "promptVersion" TEXT,
    "inputHash" TEXT NOT NULL,
    "quantidadeCandidatos" INTEGER NOT NULL,
    "justificativa" TEXT,
    "erro" TEXT,

    CONSTRAINT "AnaliseIaEmenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmendaEmpenhoRevisao" (
    "id" TEXT NOT NULL,
    "vinculoId" TEXT NOT NULL,
    "emendaId" TEXT NOT NULL,
    "empenhoId" TEXT NOT NULL,
    "situacaoAnterior" TEXT NOT NULL,
    "situacaoNova" TEXT NOT NULL,
    "valorAnterior" DECIMAL(16,2),
    "valorNovo" DECIMAL(16,2),
    "justificativa" TEXT,
    "revisadoPor" TEXT NOT NULL,
    "revisadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmendaEmpenhoRevisao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnaliseIaEmenda_resultadoGeral_idx" ON "AnaliseIaEmenda"("resultadoGeral");

-- CreateIndex
CREATE INDEX "AnaliseIaEmenda_dataAnalise_idx" ON "AnaliseIaEmenda"("dataAnalise");

-- CreateIndex
CREATE UNIQUE INDEX "AnaliseIaEmenda_emendaId_inputHash_key" ON "AnaliseIaEmenda"("emendaId", "inputHash");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoRevisao_vinculoId_idx" ON "EmendaEmpenhoRevisao"("vinculoId");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoRevisao_emendaId_idx" ON "EmendaEmpenhoRevisao"("emendaId");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoRevisao_empenhoId_idx" ON "EmendaEmpenhoRevisao"("empenhoId");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoRevisao_revisadoEm_idx" ON "EmendaEmpenhoRevisao"("revisadoEm");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoVinculo_decisao_idx" ON "EmendaEmpenhoVinculo"("decisao");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoVinculo_origem_idx" ON "EmendaEmpenhoVinculo"("origem");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoVinculo_inputHash_idx" ON "EmendaEmpenhoVinculo"("inputHash");

-- AddForeignKey
ALTER TABLE "AnaliseIaEmenda" ADD CONSTRAINT "AnaliseIaEmenda_emendaId_fkey" FOREIGN KEY ("emendaId") REFERENCES "Emenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmendaEmpenhoRevisao" ADD CONSTRAINT "EmendaEmpenhoRevisao_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "EmendaEmpenhoVinculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
