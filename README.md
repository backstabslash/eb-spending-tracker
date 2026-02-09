# EB Spending Tracker

Personal spending tracker that fetches bank transactions via the [Enable Banking API](https://enablebanking.com/) (PSD2 AISP), stores them in MongoDB, and sends daily/monthly summaries to Telegram. Dashboards via Grafana.

Supports multiple banks — add a new bank by updating config and running the auth flow. No code changes needed.

## Features

- Multi-bank, multi-account transaction fetching via Enable Banking (PSD2)
- Automatic deduplication (content-hash-based `_id`)
- Daily summary: yesterday's spending with individual line items
- Monthly summary: totals + top 5 counterparties
- Telegram notifications with optional Grafana dashboard links
- Smart fetch window: 7 days overlap (365 days on first run)
- Per-bank session management with 180-day validity

## Stack

- TypeScript, Node 22, ESM, strict mode
- Enable Banking API (PSD2 AISP)
- MongoDB 7 (native driver)
- Telegraf (Telegram bot)
- Grafana + MongoDB datasource plugin (optional)
- Kubernetes (any distro), Helm, GitHub Actions, GHCR
- HashiCorp Vault + External Secrets Operator (optional — plain k8s Secrets work too)

## Project Structure

```text
src/
  index.ts              Entry point (auth / fetch mode)
  config.ts             Env var loading + validation
  constants.ts          Shared constants (timeouts, limits, defaults)
  api/
    jwt.ts              RS256 JWT generation
    client.ts           Enable Banking API client
  db/
    mongo.ts            MongoDB connection
    collections.ts      Typed collection accessors + indexes
  models/
    transaction.ts      Transaction interface
    session.ts          Session interface
  services/
    auth.ts             Interactive bank auth flow (CLI)
    fetcher.ts          Fetch, dedup, store transactions
    summarizer.ts       Daily/monthly aggregation pipelines
    telegram.ts         Telegram message formatting + sending
test/unit/               Unit tests (mirrors src/ structure)
charts/spending-tracker/ Helm chart (CronJob + ExternalSecret)
.github/workflows/       CI/CD pipeline (build+test → deploy)
docs/setup-guide.md      Full deployment guide
```

## Configuration

### Required Environment Variables

| Variable | Description |
| --- | --- |
| `BANKS` | JSON array of bank configs (see below) |
| `MONGO_URI` | MongoDB connection string |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for summaries |

### Optional Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `GRAFANA_URL` | _(none)_ | Full Grafana dashboard URL — if set, summary messages include a dashboard link |
| `MONGO_DB_NAME` | `spending` | MongoDB database name |

### BANKS Format

```json
[
  {
    "id": "swedbank-ee",
    "name": "Swedbank",
    "country": "EE",
    "appId": "<your-app-id>",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "redirectUrl": "https://localhost:3000/callback"
  }
]
```

`redirectUrl` is optional (defaults to `https://localhost:3000/callback`). PEM keys use `\n` escape sequences inside JSON — `JSON.parse()` handles the conversion.

## Usage

Two modes:

- **`auth <bankId>`** — interactive CLI flow to link a bank account via BankID/Smart-ID (re-run every ~180 days)
- **`fetch`** — pull transactions from all banks, store in MongoDB, send Telegram summaries (designed for cron)

## Development

```bash
npm install
npm run build
npm run lint
npm test
npm run test:coverage
npm run format:check
```

## Deployment

See [docs/setup-guide.md](docs/setup-guide.md) for full deployment instructions.

The GitHub Actions workflow builds and pushes a Docker image to GHCR, then deploys via `helm upgrade`. The Helm chart runs a CronJob that executes `fetch` on schedule. Works on any Kubernetes cluster.

### Secrets

The Helm chart supports two approaches:

**Vault + ESO** (default) — set `externalSecret.enabled: true` in `values.yaml` and configure the Vault path. ESO syncs secrets to a k8s Secret automatically.

**Plain k8s Secret** — set `externalSecret.enabled: false` and create the Secret manually:

```bash
kubectl -n <namespace> create secret generic <release>-secrets \
  --from-literal=BANKS='[{"id":"...","name":"...","country":"...","appId":"...","privateKey":"..."}]' \
  --from-literal=MONGO_URI='mongodb://...' \
  --from-literal=TELEGRAM_BOT_TOKEN='...' \
  --from-literal=TELEGRAM_CHAT_ID='...'
```

The Secret name must match `<release>-secrets` (e.g. `spending-secrets` for release name `spending`).

## Adding a New Bank

1. Register a new app in [Enable Banking](https://enablebanking.com/), get the app ID and PEM key
2. Add the bank entry to the `banks` secret (Vault or env var)
3. Run `auth <bankId>` to create the session
4. No code or Helm changes needed
