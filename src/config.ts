import { DEFAULT_REDIRECT_URL } from "./constants.js";

export interface BankConfig {
  id: string;
  name: string;
  country: string;
  appId: string;
  privateKey: string;
  redirectUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseBanks(raw: string): BankConfig[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("BANKS env var must be a non-empty JSON array");
  }
  return parsed.map((b) => {
    const bank = b as Record<string, unknown>;
    if (!bank.id || !bank.name || !bank.country || !bank.appId || !bank.privateKey) {
      const safe = Object.fromEntries(Object.entries(bank).filter(([k]) => k !== "privateKey"));
      throw new Error(`Bank config missing required fields: ${JSON.stringify(safe)}`);
    }
    return {
      id: bank.id as string,
      name: bank.name as string,
      country: bank.country as string,
      appId: bank.appId as string,
      privateKey: bank.privateKey as string,
      redirectUrl: (bank.redirectUrl as string) || DEFAULT_REDIRECT_URL,
    };
  });
}

export const config = {
  banks: parseBanks(required("BANKS")),
  mongoUri: required("MONGO_URI"),
  mongoDbName: process.env.MONGO_DB_NAME || "spending",
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  grafanaUrl: process.env.GRAFANA_URL || "",
} as const;
