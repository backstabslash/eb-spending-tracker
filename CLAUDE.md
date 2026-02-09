# EB Spending Tracker

Personal spending tracker: fetches bank transactions via Enable Banking API (supports multiple banks), stores in MongoDB, sends daily/monthly summaries to Telegram, visualizes in Grafana. Deployed on k3s via GitHub Actions.

## Stack

- TypeScript, Node 22, ESM, strict mode
- Enable Banking API (PSD2 AISP) for transaction data
- MongoDB 7 (native driver, no Mongoose)
- Telegraf for Telegram notifications
- Grafana with MongoDB datasource plugin (haohanyang-mongodb-datasource, unsigned)
- k3s on VPS, Traefik for TLS
- Helm chart for deployment, GitHub Actions → GHCR → `helm upgrade`
- Secrets managed via HashiCorp Vault + External Secrets Operator

## Key Patterns

- Multi-bank: banks configured via `BANKS` env var (JSON array with id, name, country, appId, privateKey, optional redirectUrl)
- Multi-account: each bank session stores all account UIDs; fetcher iterates over all accounts
- Two modes: `auth <bankId>` (interactive BankID/Smart-ID CLI flow) and `fetch` (cron — pull transactions from all banks + send summaries)
- Dedup: `_id` = hash of transaction fields, skip on MongoDB duplicate key error (11000)
- Session: one doc per bank `_id: '<bankId>'` with upsert, stores all accounts, valid for 180 days
- Transactions tagged with `source` field (bank ID) for per-bank filtering
- Smart fetch: fetches from 7 days before latest stored transaction (or 365 days if no history)
- JWT: RS256 with `kid` = app ID, 1hr TTL, per-bank credentials
- Daily summary: yesterday's DBIT transactions with individual line items
- Monthly summary: 1st of month, spent + received totals, top 5 counterparties
- Constants: shared values (timeouts, session validity, fetch windows) centralized in `src/constants.ts`

## Environment Variables

Required: `BANKS`, `MONGO_URI`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Optional:

- `GRAFANA_URL` — full dashboard URL; if set, Telegram summaries include a link
- `MONGO_DB_NAME` — database name (default: `spending`)

## Infrastructure

- App is deployed as a Helm chart (`charts/spending-tracker/`)
- CronJob runs at `0 22 * * *` (10 PM UTC) with `fetch` arg
- Secrets come from Vault via ESO → k8s Secret in the app namespace
- All infra (Vault, ESO, MongoDB, Grafana, Traefik) managed in a separate infra repo
- GHCR package must be set to public (or configure `imagePullSecrets`)

### Vault secret structure

```text
banks             → JSON array: [{"id":"...","name":"...","country":"...","appId":"...","privateKey":"...","redirectUrl":"..."},...]
mongo-uri         → MongoDB connection string
telegram-bot-token → Telegram bot token
telegram-chat-id   → Telegram chat ID
```

PEM keys inside the JSON use `\n` escape sequences (not real newlines). `JSON.parse()` handles conversion.

## Re-authorizing Enable Banking (every ~180 days)

The EB session expires per bank. When you see `ASPSP_ERROR`, re-auth the specific bank:

```bash
kubectl run eb-auth --rm -it --restart=Never -n <namespace> \
  --image=<your-image>:latest \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "eb-auth",
      "image": "<your-image>:latest",
      "args": ["auth", "<bank-id>"],
      "envFrom": [{"secretRef": {"name": "<your-secret>"}}],
      "stdin": true,
      "tty": true
    }]
  }
}'
```

### Adding a new bank

1. Update the `banks` JSON in Vault (add new entry with id, name, country, appId, privateKey)
2. Run `auth <bankId>` to create the session
3. No code or Helm changes needed

## Enable Banking API Gotchas

- `valid_until` requires full ISO datetime with timezone (not just date)
- Redirect URL in auth must match what's registered in the EB app (configured per bank via `redirectUrl` field)
- Direction values are PSD2 codes: `DBIT`/`CRDT` (NOT `DEBIT`/`CREDIT`)
- Transaction endpoint is `/accounts/{uid}/transactions` (no session ID in path)
- Many field names may differ from assumptions — always check raw API response before mapping
- API has 4x/day rate limit per app

## Commands

- `npm run build` — compile TypeScript
- `npm test` — run unit tests (Vitest)
- `npm run test:watch` — run tests in watch mode
- `npm run test:coverage` — run tests with coverage report
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format` / `npm run format:check` — Prettier

## Code Style

- Don't leave single-line comments for changes unless really necessary
- ESLint + Prettier enforced (see `.prettierrc` and `eslint.config.js`)
- Prefer simple, direct code — no over-abstraction
