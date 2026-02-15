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

   ```text
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
| --- | --- |
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

## Adding a new bank

1. Register a new app in Enable Banking, get app ID and PEM key
2. Add the bank entry to the `banks` JSON in Vault
3. Run the auth flow (see [Operations](#operations)) to create the session
4. No code or Helm changes needed

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

## Operations

### Manual fetch

Trigger the regular fetch (same as the nightly cron):

```bash
kubectl -n spending create job --from=cronjob/spending-spending-tracker manual-fetch
kubectl -n spending logs -f job/manual-fetch
```

### Manual fetch with full lookback

Fetch the maximum transaction history (365 days, auto-capped if the bank limits it). This runs automatically every Monday, but you can trigger it manually:

```bash
kubectl run eb-full-fetch --rm -it --restart=Never -n spending \
  --image=ghcr.io/backstabslash/eb-spending-tracker:<tag> \
  --overrides='{
  "spec": {
    "containers": [{
      "name": "eb-full-fetch",
      "image": "ghcr.io/backstabslash/eb-spending-tracker:<tag>",
      "args": ["fetch", "--full"],
      "envFrom": [{"secretRef": {"name": "spending-secrets"}}]
    }]
  }
}'
```

Replace `<tag>` with the deployed commit SHA or `latest`.

### Re-authorize a bank

Bank sessions expire every ~180 days. When you see `ASPSP_ERROR`, re-auth the specific bank:

```bash
kubectl run eb-auth --rm -it --restart=Never -n spending \
  --image=ghcr.io/backstabslash/eb-spending-tracker:<tag> \
  --overrides='{
  "spec": {
    "containers": [{
      "name": "eb-auth",
      "image": "ghcr.io/backstabslash/eb-spending-tracker:<tag>",
      "args": ["auth", "<bank-id>"],
      "envFrom": [{"secretRef": {"name": "spending-secrets"}}],
      "stdin": true,
      "tty": true
    }]
  }
}'
```

1. Open the printed URL in your browser
2. Confirm with Smart-ID/BankID on your phone
3. Browser redirects to your callback URL — page won't load, that's fine
4. Copy the full URL from the address bar and paste it into the terminal
