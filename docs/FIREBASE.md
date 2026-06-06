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
OPENAI_API_KEY
```

Para criar/atualizar o secret da OpenAI:

```bash
firebase apphosting:secrets:set OPENAI_API_KEY --project emendas-impositivas2026
```

Cole o valor quando solicitado. Em seguida, conceda permissao para o
backend ler o secret:

```bash
firebase apphosting:secrets:grantaccess OPENAI_API_KEY \
  --backend emendas-impositivas2026 --project emendas-impositivas2026
```

A IA fica ativada em producao pelo `apphosting.yaml`:

```text
OPENAI_EMPENHO_ENABLED=true
OPENAI_EMPENHO_MODEL=gpt-5.5
```

Para desativar temporariamente, mude `OPENAI_EMPENHO_ENABLED` para
`"false"` em `apphosting.yaml` e refaca o rollout.

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
