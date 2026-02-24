import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DailySummary, MonthlySummary } from "../../../src/services/summarizer.js";

const mockSendMessage = vi.fn();

const mockConfig = {
  telegramBotToken: "test-token",
  telegramChatId: "test-chat",
  grafanaUrl: "",
  banks: [],
  mongoUri: "",
  mongoDbName: "spending",
};

vi.mock("telegraf", () => {
  return {
    Telegraf: class {
      telegram = { sendMessage: mockSendMessage };
    },
  };
});

vi.mock("../../../src/config.js", () => ({
  config: mockConfig,
}));

const { sendDailySummary, sendMonthlySummary } = await import("../../../src/services/telegram.js");

function lastMessage(): string {
  return mockSendMessage.mock.calls[0][1] as string;
}

function lastOptions(): Record<string, unknown> {
  return mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
}

describe("sendDailySummary", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockConfig.grafanaUrl = "";
  });

  const dailySummary: DailySummary = {
    date: new Date("2025-06-15T00:00:00Z"),
    totalSpent: 45.5,
    currency: "EUR",
    transactions: [
      { counterpartyName: "Wolt", amount: 25.5, currency: "EUR" },
      { counterpartyName: "Bolt", amount: 20.0, currency: "EUR" },
    ],
  };

  it("sends message with date, total, and transactions", async () => {
    await sendDailySummary(dailySummary);

    expect(mockSendMessage).toHaveBeenCalledOnce();
    const msg = lastMessage();
    expect(msg).toContain("15.06.2025");
    expect(msg).toContain("45.50 EUR");
    expect(msg).toContain("Wolt");
    expect(msg).toContain("25.50 EUR");
    expect(msg).toContain("Bolt");
    expect(msg).toContain("20.00 EUR");
  });

  it("includes Grafana link when grafanaUrl is set", async () => {
    mockConfig.grafanaUrl = "https://grafana.example/d/abc";
    await sendDailySummary(dailySummary);

    expect(lastMessage()).toContain("https://grafana.example/d/abc");
    expect(lastMessage()).toContain("Dashboard");
  });

  it("omits Grafana link when grafanaUrl is empty", async () => {
    await sendDailySummary(dailySummary);
    expect(lastMessage()).not.toContain("Dashboard");
  });

  it("uses HTML parse_mode", async () => {
    await sendDailySummary(dailySummary);
    expect(lastOptions().parse_mode).toBe("HTML");
  });
});

describe("sendMonthlySummary", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockConfig.grafanaUrl = "";
  });

  const monthlySummary: MonthlySummary = {
    month: "2025-06",
    totalSpent: 1200.0,
    totalReceived: 3000.0,
    currency: "EUR",
    topCounterparties: [
      { name: "Wolt", total: 350.0 },
      { name: "Rimi", total: 280.0 },
    ],
  };

  it("sends message with month, spent/received totals, and top counterparties", async () => {
    await sendMonthlySummary(monthlySummary);

    expect(mockSendMessage).toHaveBeenCalledOnce();
    const msg = lastMessage();
    expect(msg).toContain("06.2025");
    expect(msg).toContain("1200.00 EUR");
    expect(msg).toContain("3000.00 EUR");
    expect(msg).toContain("Wolt");
    expect(msg).toContain("-350.00 EUR");
    expect(msg).toContain("Rimi");
  });

  it("includes Grafana link when grafanaUrl is set", async () => {
    mockConfig.grafanaUrl = "https://grafana.example/d/abc";
    await sendMonthlySummary(monthlySummary);

    expect(lastMessage()).toContain("https://grafana.example/d/abc");
    expect(lastMessage()).toContain("Dashboard");
  });

  it("omits Grafana link when grafanaUrl is empty", async () => {
    await sendMonthlySummary(monthlySummary);
    expect(lastMessage()).not.toContain("Dashboard");
  });

  it("omits Top spending section when counterparties array is empty", async () => {
    await sendMonthlySummary({ ...monthlySummary, topCounterparties: [] });
    expect(lastMessage()).not.toContain("Top spending");
  });
});
