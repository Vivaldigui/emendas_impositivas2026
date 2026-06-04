export type Vereador = {
  id: string;
  nome: string;
  nomeCurto: string;
  partido?: string;
  foto: string;
};

export type FonteDocumento = {
  id: string;
  titulo: string;
  href: string;
  tipo: "tabela-base" | "projeto-lei" | "lei";
};

export type Emenda = {
  id: string;
  vereadorId: string;
  descricao: string;
  valorAutorizado: number;
  area: string;
  secretaria: string;
  codigo?: string | null;
  acao?: string | null;
  dotacao?: string | null;
  fonteDocumentoId: string;
};

export type EmpenhoRecord = {
  id: string;
  ano: number;
  numeroEmpenho: string | null;
  dataEmpenho: string | null;
  fornecedor: string | null;
  cnpjCpfFornecedor?: string | null;
  historico: string | null;
  secretaria: string | null;
  dotacao: string | null;
  ficha: string | null;
  processoCompra: string | null;
  valorEmpenhado: number;
  valorLiquidado: number;
  valorPago: number;
  situacao: string | null;
  fonte: string;
  hashArquivo?: string | null;
  linhaBruta?: Record<string, unknown>;
};

export type CriterioVinculo =
  | "acao_dotacao"
  | "codigo_secretaria"
  | "historico_secretaria"
  | "similaridade_objeto"
  | "conferir";

export type EmendaEmpenhoVinculo = {
  emendaId: string;
  empenhoId: string;
  criterio: CriterioVinculo;
  confianca: number;
  observacao: string;
};

export type SituacaoEmenda =
  | "Aguardando empenho"
  | "Empenhada"
  | "Parcial"
  | "Liquidada"
  | "Paga"
  | "Conferir";

export type EmendaResumo = Emenda & {
  vereador: Vereador;
  valorEmpenhado: number;
  valorLiquidado: number;
  valorPago: number;
  saldo: number;
  percentualExecucao: number;
  situacao: SituacaoEmenda;
  vinculos: Array<EmendaEmpenhoVinculo & { empenho: EmpenhoRecord }>;
};

export type VereadorResumo = Vereador & {
  totalAutorizado: number;
  totalEmpenhado: number;
  totalLiquidado: number;
  totalPago: number;
  saldo: number;
  percentualExecucao: number;
  quantidadeEmendas: number;
  pendencias: number;
};

export type ColetaStatus = "SUCESSO" | "PARCIAL" | "ERRO";

export type ColetaLogEntry = {
  timestamp: string;
  status: ColetaStatus;
  mensagem: string;
  etapa: string;
  endpoint?: string | null;
  hashArquivo?: string | null;
  caminhoArquivo?: string | null;
  erro?: string | null;
  metadados?: Record<string, unknown>;
};
