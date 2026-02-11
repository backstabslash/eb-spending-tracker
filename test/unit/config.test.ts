import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_BANK } from "../fixtures.js";

const VALID_BANK = {
  id: TEST_BANK.id,
  name: TEST_BANK.name,
  country: TEST_BANK.country,
  appId: TEST_BANK.appId,
  privateKey: TEST_BANK.privateKey,
};

const ENV_KEYS = ["BANKS", "MONGO_URI", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "GRAFANA_URL", "MONGO_DB_NAME"];

function setRequiredEnv(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    BANKS: JSON.stringify([VALID_BANK]),
    MONGO_URI: "mongodb://localhost:27017",
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_CHAT_ID: "chat-id",
  };
  Object.assign(process.env, defaults, overrides);
}

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

async function loadConfig() {
  const mod = await import("../../src/config.js");
  return mod.config;
}

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
  });

  it("parses valid config with defaults", async () => {
    setRequiredEnv();
    const config = await loadConfig();

    expect(config.banks).toHaveLength(1);
    expect(config.banks[0]).toMatchObject({
      id: "test-bank",
      name: "Test Bank",
      country: "EE",
      appId: "app-123",
      redirectUrl: "https://localhost:3000/callback",
    });
    expect(config.mongoDbName).toBe("spending");
    expect(config.grafanaUrl).toBe("");
  });

  it("passes through custom redirectUrl, MONGO_DB_NAME, GRAFANA_URL", async () => {
    const bankWithRedirect = { ...VALID_BANK, redirectUrl: "https://custom.example/cb" };
    setRequiredEnv({
      BANKS: JSON.stringify([bankWithRedirect]),
      MONGO_DB_NAME: "custom-db",
      GRAFANA_URL: "https://grafana.example/d/abc",
    });
    const config = await loadConfig();

    expect(config.banks[0].redirectUrl).toBe("https://custom.example/cb");
    expect(config.mongoDbName).toBe("custom-db");
    expect(config.grafanaUrl).toBe("https://grafana.example/d/abc");
  });

  it("parses multiple banks", async () => {
    const banks = [
      VALID_BANK,
      { ...VALID_BANK, id: "second-bank", name: "Second Bank" },
    ];
    setRequiredEnv({ BANKS: JSON.stringify(banks) });
    const config = await loadConfig();

    expect(config.banks).toHaveLength(2);
    expect(config.banks[1].id).toBe("second-bank");
  });

  it.each(["BANKS", "MONGO_URI", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"])(
    "throws when %s is missing",
    async (envVar) => {
      setRequiredEnv();
      delete process.env[envVar];
      await expect(loadConfig()).rejects.toThrow();
    },
  );

  it("throws on invalid JSON in BANKS", async () => {
    setRequiredEnv({ BANKS: "not-json" });
    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws on empty array in BANKS", async () => {
    setRequiredEnv({ BANKS: "[]" });
    await expect(loadConfig()).rejects.toThrow("non-empty");
  });

  it("throws when bank is missing required fields", async () => {
    setRequiredEnv({ BANKS: JSON.stringify([{ id: "incomplete" }]) });
    await expect(loadConfig()).rejects.toThrow("missing required fields");
  });
});
