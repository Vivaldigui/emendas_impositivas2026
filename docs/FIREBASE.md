# Deploy no Firebase

Este projeto usa Firebase App Hosting para preservar o Next.js server-side, as
rotas `/api/*` e o acesso ao Prisma Postgres.

## Alvo

- Projeto Firebase: `emendas-impositivas2026`
- Backend App Hosting: `emendas-impositivas2026`
- Regiao: `us-central1`
- URL: `https://emendas-impositivas2026--emendas-impositivas2026.us-central1.hosted.app`

## Arquivos

- `.firebaserc`: aponta o projeto padrao.
- `apphosting.yaml`: define recursos de runtime e variaveis/secrets.

## Secrets configurados

Os valores devem existir no Secret Manager/App Hosting:

```text
DATABASE_URL
COLETA_ADMIN_SECRET
CRON_SECRET
```

A IA fica desligada no deploy inicial:

```text
OPENAI_EMPENHO_ENABLED=false
OPENAI_EMPENHO_MODEL=gpt-5.4-mini
```

Para ativar IA em producao, crie o secret `OPENAI_API_KEY`, inclua-o em
`apphosting.yaml` e altere `OPENAI_EMPENHO_ENABLED` para `true`.

## Publicar rollout

O App Hosting publica a partir do GitHub. Depois de commitar e enviar para
`main`, rode:

```bash
firebase apphosting:rollouts:create emendas-impositivas2026 --project emendas-impositivas2026 --git-branch main --force
```

## Verificar

```bash
curl https://emendas-impositivas2026--emendas-impositivas2026.us-central1.hosted.app
curl https://emendas-impositivas2026--emendas-impositivas2026.us-central1.hosted.app/api/dashboard
```
