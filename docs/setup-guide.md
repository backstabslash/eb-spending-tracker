# Setup Guide

## VPS: Install k3s

```bash
curl -sfL https://get.k3s.io | sh -
kubectl get nodes  # verify
```

k3s comes with Traefik built-in. Configure a `traefik-config.yaml` for automatic HTTPS via Let's Encrypt, and an `IngressRoute` to expose Grafana (or other services).

**DNS**: create an A record for your domain (e.g. `grafana.example.com`) pointing to your VPS IP.

## Telegram bot

1. Message `@BotFather` → `/newbot` → save the **bot token**
2. Add the bot to your chat
3. Send any message in the chat, then:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
   Find `"chat":{"id": ...}` → that's your **chat ID**

## Vault secrets

All secrets are stored in HashiCorp Vault (path is configurable in the Helm chart). The `banks` property is a JSON array containing bank configurations with PEM keys using `\n` escape sequences:

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

Other Vault properties:
- `mongo-uri` — MongoDB connection string
- `telegram-bot-token` — from BotFather
- `telegram-chat-id` — from getUpdates

ESO syncs these to a k8s Secret in your namespace.

## GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions:

| Secret | Description |
|---|---|
| `KUBECONFIG_DATA` | Base64-encoded kubeconfig for your k3s cluster |

Bank credentials and other app secrets are managed in Vault, not GHA secrets.

## Deploy

```bash
git branch -M main
gh repo create eb-spending-tracker --private --source=. --push
```

Push to `main` triggers GHA: build image → push to GHCR → `helm upgrade`.

**GHCR package visibility**: the container package defaults to private. Make it public so k3s can pull without a registry secret:
GitHub profile → Packages → `eb-spending-tracker` → Package settings → Change visibility → Public.

Alternatively, configure `imagePullSecrets` in the Helm chart to use a private registry.

## Auth flow (per bank, re-run every ~180 days)

Link a bank account via Smart-ID/BankID. The redirect URL must match what's registered in your Enable Banking app.

```bash
kubectl run eb-auth --rm -it --restart=Never -n <namespace> \
  --image=ghcr.io/<your-github-username>/eb-spending-tracker:latest \
  --overrides='{"spec":{"containers":[{"name":"eb-auth","image":"ghcr.io/<your-github-username>/eb-spending-tracker:latest","args":["auth","<bank-id>"],"stdin":true,"tty":true,"envFrom":[{"secretRef":{"name":"<your-secret-name>"}}]}]}}' \
  -- auth <bank-id>
```

1. Open the printed URL in your browser
2. Confirm with Smart-ID/BankID on your phone
3. Browser redirects to your callback URL — page won't load, that's fine
4. Copy the full URL from the address bar and paste it into the terminal

### Adding a new bank

1. Register a new app in Enable Banking, get app ID and PEM key
2. Add the bank entry to the `banks` JSON in Vault
3. Run `auth <bankId>` to create the session
4. No code or Helm changes needed

## Verify

```bash
kubectl -n <namespace> create job --from=cronjob/<cronjob-name> test-fetch
kubectl -n <namespace> logs -f job/test-fetch
```

You should see `[BankName] Fetched X transactions, Y new` per bank, and a daily summary in your Telegram chat.

## Grafana datasource

In Grafana UI → Connections → Add datasource → MongoDB:
- **Connection string scheme**: `mongodb`
- **Host**: your MongoDB service address (e.g. `mongodb.<namespace>.svc`)
- **Port**: `27017`
- **Database**: your `MONGO_DB_NAME` value (default: `spending`)
- **Authentication**: Username/Password
- **Username**: your MongoDB username
- **Password**: your MongoDB password
- **Connection parameters**: `authSource=admin`

Set `GRAFANA_URL` env var to your dashboard URL to include links in Telegram summaries.

## Useful kubectl commands

```bash
# Check pod status
kubectl -n <namespace> get pods

# View fetch job logs
kubectl -n <namespace> logs -f job/<job-name>

# Trigger a manual fetch
kubectl -n <namespace> create job --from=cronjob/<cronjob-name> manual-fetch
kubectl -n <namespace> logs -f job/manual-fetch

# MongoDB shell
echo '<query>' | kubectl -n <db-namespace> exec -i deployment/mongodb -- mongosh "mongodb://<user>:<password>@localhost:27017/<db-name>?authSource=admin"

# View CronJob schedule and history
kubectl -n <namespace> get cronjobs
kubectl -n <namespace> get jobs

# Delete completed/failed jobs
kubectl -n <namespace> delete jobs --field-selector status.successful=1

# Check secrets (base64 decoded)
kubectl -n <namespace> get secret <secret-name> -o jsonpath='{.data.BANKS}' | base64 -d
```
