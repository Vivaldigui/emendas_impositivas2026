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
  unidadeOrcamentaria?: string | null;
  naturezaDespesa?: string | null;
  modalidadeAplicacao?: string | null;
  fonteRecurso?: string | null;
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

export type OrigemVinculo = "REGRA" | "IA" | "MANUAL";
export type DecisaoVinculo = "SUGERIDO" | "CONFERIR" | "CONFIRMADO" | "REJEITADO";
export type ResultadoAnaliseIa = "SUGERIR_VINCULOS" | "CONFERIR" | "SEM_VINCULO" | "ERRO";

export type EmendaEmpenhoVinculo = {
  id?: string;
  emendaId: string;
  empenhoId: string;
  criterio: CriterioVinculo;
  confianca: number | null;
  observacao: string;
  valorAtribuido?: number | null;
  origem?: OrigemVinculo;
  decisao?: DecisaoVinculo;
  criterios?: string[];
  divergencias?: string[];
  justificativaCurta?: string | null;
  camposUsados?: string[];
  modelo?: string | null;
  promptVersion?: string | null;
  inputHash?: string | null;
  scoreDeterministico?: number;
  criadoEm?: string | null;
  atualizadoEm?: string | null;
  revisadoEm?: string | null;
  revisadoPor?: string | null;
};

export type AnaliseIaResumo = {
  id: string;
  emendaId: string;
  resultadoGeral: ResultadoAnaliseIa;
  dataAnalise: string;
  modelo: string | null;
  promptVersion: string | null;
  inputHash: string;
  quantidadeCandidatos: number;
  justificativa: string | null;
  erro: string | null;
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
  analiseIa?: AnaliseIaResumo | null;
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
