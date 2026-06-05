# Operacao do Dashboard de Emendas

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Coleta manual

```bash
npm run collect:empenhos -- --inicio=2026-01-01 --fim=hoje --formato=excel --modo=auto
```

Modo visual para diagnostico do Portal Cidadao:

```bash
npm run collect:empenhos:debug
```

Importar arquivo ja baixado manualmente do Portal Cidadao:

```bash
npm run collect:empenhos -- --arquivo="C:\caminho\analiticoEmpenhos.xls" --inicio=2026-01-01 --fim=hoje
```

## Coleta por API

```bash
curl -X POST http://localhost:3000/api/admin/coletas/empenhos \
  -H "Content-Type: application/json" \
  -d "{\"inicio\":\"2026-01-01\",\"fim\":\"hoje\",\"formato\":\"excel\",\"modo\":\"auto\"}"
```

Em producao, configure `COLETA_ADMIN_SECRET` e envie:

```text
Authorization: Bearer <COLETA_ADMIN_SECRET>
```

## Rotina diaria

O arquivo `vercel.json` agenda `GET /api/cron/coletar-empenhos` em `0 10 * * *`,
que corresponde a 07:00 em `America/Sao_Paulo`.

Configure `CRON_SECRET` no servidor. A rota aceita o cabecalho:

```text
Authorization: Bearer <CRON_SECRET>
```

## Arquivos e auditoria

Os relatorios brutos, metadados e logs ficam em:

```text
storage/sonner/empenhos
```

Cada artefato salvo inclui hash SHA-256, parametros usados, fonte oficial,
periodo consultado, registros normalizados e avisos do parser.

## Endpoint direto opcional

Se o endpoint exato do relatorio de empenhos for capturado no DevTools, configure:

```text
SONNER_EMPENHOS_ENDPOINT=https://sistema.itanhandu.mg.gov.br/GRP/portalcidadao/webservices/...
```

Sem esse valor, `--modo=auto` usa Playwright publico para abrir o portal e capturar
o arquivo gerado pela interface.

## Vinculo assistido por IA

O sistema usa uma abordagem hibrida:

1. regras deterministicas selecionam ate 5 empenhos candidatos por emenda;
2. a IA, quando habilitada, analisa somente esses candidatos;
3. a IA grava apenas `SUGERIDO`, `CONFERIR` ou `SEM_VINCULO`;
4. somente usuario autorizado pode mudar um vinculo para `CONFIRMADO` ou `REJEITADO`.

Registros confirmados ou rejeitados manualmente nao sao sobrescritos por novas
analises.

## Variaveis de ambiente da IA

```text
OPENAI_API_KEY=
OPENAI_EMPENHO_MODEL=gpt-5.4-mini
OPENAI_EMPENHO_ENABLED=true
```

Para desativar a IA sem desligar o dashboard:

```text
OPENAI_EMPENHO_ENABLED=false
```

Sem `OPENAI_API_KEY`, o app continua funcionando com o matcher deterministico e
o painel mostra `Analise de IA indisponivel`.

## Executar analise

Analise pendente de todas as emendas:

```bash
curl -X POST http://localhost:3000/api/admin/ia/vincular-empenhos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>" \
  -d "{}"
```

Analisar emendas especificas:

```bash
curl -X POST http://localhost:3000/api/admin/ia/vincular-empenhos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>" \
  -d "{\"emendaIds\":[\"vinicius-lar-idosos\"],\"reanalisar\":true}"
```

Simular sem gravar:

```bash
curl -X POST http://localhost:3000/api/admin/ia/vincular-empenhos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>" \
  -d "{\"dryRun\":true}"
```

## Confirmar, rejeitar ou editar valor

Antes de confirmar, confira documentos orcamentarios e o historico do empenho.

```bash
curl -X POST http://localhost:3000/api/admin/ia/vinculos/<vinculoId>/revisar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>" \
  -d "{\"acao\":\"CONFIRMAR\",\"valorAtribuido\":5000}"
```

Rejeicao exige justificativa:

```bash
curl -X POST http://localhost:3000/api/admin/ia/vinculos/<vinculoId>/revisar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>" \
  -d "{\"acao\":\"REJEITAR\",\"justificativa\":\"Objeto divergente\"}"
```

Editar valor atribuido:

```bash
curl -X POST http://localhost:3000/api/admin/ia/vinculos/<vinculoId>/revisar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>" \
  -d "{\"acao\":\"ALTERAR_VALOR\",\"valorAtribuido\":2500,\"justificativa\":\"Execucao parcial\"}"
```

Consultar historico:

```bash
curl http://localhost:3000/api/admin/ia/revisoes?emendaId=vinicius-lar-idosos \
  -H "Authorization: Bearer <COLETA_ADMIN_SECRET>"
```

## Regras de protecao

- O modelo nunca confirma automaticamente.
- IDs retornados pela IA precisam estar entre os candidatos enviados.
- Valores negativos sao rejeitados.
- O mesmo par emenda/empenho nao pode ser duplicado.
- A soma atribuida a uma emenda ou a um empenho nao pode ultrapassar o valor
  respectivo, exceto com autorizacao manual e justificativa.
- Toda revisao manual registra usuario, data, situacao anterior, situacao nova e
  valor anterior/novo.
