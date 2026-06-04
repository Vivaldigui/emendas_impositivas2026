-- CreateTable
CREATE TABLE "Vereador" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeCurto" TEXT NOT NULL,
    "partido" TEXT,
    "foto" TEXT NOT NULL,

    CONSTRAINT "Vereador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Emenda" (
    "id" TEXT NOT NULL,
    "vereadorId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorAutorizado" DECIMAL(16,2) NOT NULL,
    "area" TEXT NOT NULL,
    "secretaria" TEXT NOT NULL,
    "codigo" TEXT,
    "acao" TEXT,
    "dotacao" TEXT,
    "fonteDocumento" TEXT NOT NULL,

    CONSTRAINT "Emenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empenho" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "numeroEmpenho" TEXT,
    "dataEmpenho" TIMESTAMP(3),
    "fornecedor" TEXT,
    "cnpjCpfFornecedor" TEXT,
    "historico" TEXT,
    "secretaria" TEXT,
    "dotacao" TEXT,
    "ficha" TEXT,
    "processoCompra" TEXT,
    "valorEmpenhado" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "valorLiquidado" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "valorPago" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "situacao" TEXT,
    "fonte" TEXT NOT NULL,
    "hashArquivo" TEXT,
    "linhaBruta" JSONB,

    CONSTRAINT "Empenho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmendaEmpenhoVinculo" (
    "id" TEXT NOT NULL,
    "emendaId" TEXT NOT NULL,
    "empenhoId" TEXT NOT NULL,
    "criterio" TEXT NOT NULL,
    "confianca" DECIMAL(5,2) NOT NULL,
    "observacao" TEXT NOT NULL,

    CONSTRAINT "EmendaEmpenhoVinculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColetaEmpenhosArquivo" (
    "id" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "formato" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "endpoint" TEXT,
    "parametrosJson" JSONB NOT NULL,
    "hashArquivo" TEXT NOT NULL,
    "caminhoArquivo" TEXT NOT NULL,
    "contentType" TEXT,
    "dataColeta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "erro" TEXT,
    "registrosBrutos" INTEGER NOT NULL DEFAULT 0,
    "registrosImportados" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ColetaEmpenhosArquivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColetaLog" (
    "id" TEXT NOT NULL,
    "coletor" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "mensagem" TEXT,
    "erro" TEXT,
    "metadados" JSONB,

    CONSTRAINT "ColetaLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Emenda_vereadorId_idx" ON "Emenda"("vereadorId");

-- CreateIndex
CREATE INDEX "Emenda_area_idx" ON "Emenda"("area");

-- CreateIndex
CREATE INDEX "Emenda_acao_idx" ON "Emenda"("acao");

-- CreateIndex
CREATE INDEX "Empenho_ano_numeroEmpenho_idx" ON "Empenho"("ano", "numeroEmpenho");

-- CreateIndex
CREATE INDEX "Empenho_fornecedor_idx" ON "Empenho"("fornecedor");

-- CreateIndex
CREATE INDEX "Empenho_dotacao_idx" ON "Empenho"("dotacao");

-- CreateIndex
CREATE INDEX "EmendaEmpenhoVinculo_criterio_idx" ON "EmendaEmpenhoVinculo"("criterio");

-- CreateIndex
CREATE UNIQUE INDEX "EmendaEmpenhoVinculo_emendaId_empenhoId_key" ON "EmendaEmpenhoVinculo"("emendaId", "empenhoId");

-- CreateIndex
CREATE UNIQUE INDEX "ColetaEmpenhosArquivo_hashArquivo_key" ON "ColetaEmpenhosArquivo"("hashArquivo");

-- CreateIndex
CREATE INDEX "ColetaEmpenhosArquivo_inicio_fim_idx" ON "ColetaEmpenhosArquivo"("inicio", "fim");

-- CreateIndex
CREATE INDEX "ColetaEmpenhosArquivo_dataColeta_idx" ON "ColetaEmpenhosArquivo"("dataColeta");

-- CreateIndex
CREATE INDEX "ColetaLog_coletor_status_idx" ON "ColetaLog"("coletor", "status");

-- CreateIndex
CREATE INDEX "ColetaLog_inicioEm_idx" ON "ColetaLog"("inicioEm");

-- AddForeignKey
ALTER TABLE "Emenda" ADD CONSTRAINT "Emenda_vereadorId_fkey" FOREIGN KEY ("vereadorId") REFERENCES "Vereador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmendaEmpenhoVinculo" ADD CONSTRAINT "EmendaEmpenhoVinculo_emendaId_fkey" FOREIGN KEY ("emendaId") REFERENCES "Emenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmendaEmpenhoVinculo" ADD CONSTRAINT "EmendaEmpenhoVinculo_empenhoId_fkey" FOREIGN KEY ("empenhoId") REFERENCES "Empenho"("id") ON DELETE CASCADE ON UPDATE CASCADE;
