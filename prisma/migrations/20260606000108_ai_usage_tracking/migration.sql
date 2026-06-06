-- AlterTable
ALTER TABLE "AnaliseIaEmenda" ADD COLUMN     "custoEstimadoUsd" DECIMAL(12,6),
ADD COLUMN     "tokensEntrada" INTEGER,
ADD COLUMN     "tokensEntradaCache" INTEGER,
ADD COLUMN     "tokensSaida" INTEGER,
ADD COLUMN     "tokensTotal" INTEGER;

-- CreateIndex
CREATE INDEX "AnaliseIaEmenda_modelo_dataAnalise_idx" ON "AnaliseIaEmenda"("modelo", "dataAnalise");
