# Emendas Impositivas de Itanhandu

Dashboard standalone para acompanhar as emendas impositivas de 2026 por vereador,
area e situacao financeira, com cruzamento de empenhos oficiais do Portal Cidadao.

## Comandos

```bash
npm install
npm run dev
npm run test
npm run collect:empenhos -- --inicio=2026-01-01 --fim=hoje --formato=excel --modo=auto
```

## APIs

- `GET /api/dashboard`
- `GET /api/vereadores`
- `GET /api/emendas`
- `GET /api/admin/coletas/empenhos`
- `POST /api/admin/coletas/empenhos`
- `GET /api/cron/coletar-empenhos`

Detalhes operacionais em `docs/OPERACAO.md`.
