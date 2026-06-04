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
