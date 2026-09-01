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

const { sendDailySummary, sendMonthlySummary, sendSessionAlert } =
  await import("../../../src/services/telegram.js");

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
    totals: [{ currency: "EUR", spent: 45.5, received: 0 }],
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

  it("lists each currency separately instead of summing them", async () => {
    await sendDailySummary({
      ...dailySummary,
      totals: [
        { currency: "EUR", spent: 45.5, received: 0 },
        { currency: "SEK", spent: 300.0, received: 0 },
      ],
    });

    const msg = lastMessage();
    expect(msg).toContain("45.50 EUR + 300.00 SEK");
    expect(msg).not.toContain("345.50");
  });
});

describe("sendMonthlySummary", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockConfig.grafanaUrl = "";
  });

  const monthlySummary: MonthlySummary = {
    month: "2025-06",
    totals: [{ currency: "EUR", spent: 1200.0, received: 3000.0 }],
    topCounterparties: [
      { name: "Wolt", currency: "EUR", total: 350.0 },
      { name: "Rimi", currency: "EUR", total: 280.0 },
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

  it("keeps currencies apart in totals and top spending", async () => {
    await sendMonthlySummary({
      ...monthlySummary,
      totals: [
        { currency: "EUR", spent: 1200.0, received: 3000.0 },
        { currency: "SEK", spent: 500.0, received: 0 },
      ],
      topCounterparties: [
        { name: "Wolt", currency: "EUR", total: 350.0 },
        { name: "ICA", currency: "SEK", total: 500.0 },
      ],
    });

    const msg = lastMessage();
    expect(msg).toContain("1200.00 EUR + 500.00 SEK");
    expect(msg).toContain("3000.00 EUR");
    expect(msg).not.toContain("3000.00 EUR + 0.00 SEK");
    expect(msg).toContain("-500.00 SEK");
    expect(msg).not.toContain("1700.00");
  });
});

describe("sendSessionAlert", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockConfig.grafanaUrl = "";
  });

  it("sends nothing when there are no alerts", async () => {
    await sendSessionAlert([]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("lists expiring banks with days left", async () => {
    await sendSessionAlert([
      { bankId: "swedbank-ee", bankName: "Swedbank", status: "expiring", daysLeft: 12 },
    ]);

    const msg = lastMessage();
    expect(msg).toContain("Swedbank");
    expect(msg).toContain("12 days");
    expect(msg).toContain("auth swedbank-ee");
  });

  it("uses singular wording for the last day", async () => {
    await sendSessionAlert([
      { bankId: "revolut-lt", bankName: "Revolut", status: "expiring", daysLeft: 1 },
    ]);

    expect(lastMessage()).toContain("1 day");
    expect(lastMessage()).not.toContain("1 days");
  });

  it("separates expired banks from expiring ones", async () => {
    await sendSessionAlert([
      { bankId: "swedbank-ee", bankName: "Swedbank", status: "expired", daysLeft: 0 },
      { bankId: "revolut-lt", bankName: "Revolut", status: "expiring", daysLeft: 5 },
    ]);

    const msg = lastMessage();
    expect(msg).toContain("Auth expired");
    expect(msg).toContain("Auth expiring");
    expect(msg.indexOf("Swedbank")).toBeLessThan(msg.indexOf("Revolut"));
  });

  it("treats a missing session as expired", async () => {
    await sendSessionAlert([
      { bankId: "swedbank-ee", bankName: "Swedbank", status: "missing", daysLeft: 0 },
    ]);

    expect(lastMessage()).toContain("Auth expired");
    expect(lastMessage()).toContain("auth swedbank-ee");
  });
});
