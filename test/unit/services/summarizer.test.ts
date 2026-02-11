import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Document } from "mongodb";

const mockToArray = vi.fn();
const mockAggregate = vi.fn().mockReturnValue({ toArray: mockToArray });
const mockProject = vi.fn().mockReturnValue({ toArray: mockToArray });
const mockSort = vi.fn().mockReturnValue({ project: mockProject });
const mockFind = vi.fn().mockReturnValue({ sort: mockSort });

vi.mock("../../../src/db/collections.js", () => ({
  transactions: () => ({
    aggregate: mockAggregate,
    find: mockFind,
  }),
}));

const { getDailySummary, getMonthlySummary } = await import(
  "../../../src/services/summarizer.js"
);

function lastAggregateMatch(): Document {
  return mockAggregate.mock.calls[0][0][0].$match;
}

describe("getDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no transactions exist", async () => {
    mockToArray.mockResolvedValueOnce([]);

    const result = await getDailySummary(new Date("2025-06-15T00:00:00Z"));

    expect(result).toBeNull();
  });

  it("returns summary with transactions for the given day", async () => {
    mockToArray
      .mockResolvedValueOnce([{ totalSpent: 55.0, totalReceived: 0, currency: "EUR" }])
      .mockResolvedValueOnce([
        { counterpartyName: "Wolt", amount: 30, currency: "EUR" },
        { counterpartyName: "Bolt", amount: 25, currency: "EUR" },
      ]);

    const date = new Date("2025-06-15T00:00:00Z");
    const result = await getDailySummary(date);

    expect(result).toEqual({
      date,
      totalSpent: 55.0,
      currency: "EUR",
      transactions: [
        { counterpartyName: "Wolt", amount: 30, currency: "EUR" },
        { counterpartyName: "Bolt", amount: 25, currency: "EUR" },
      ],
    });
  });

  it("filters for DBIT transactions within the date range", async () => {
    mockToArray.mockResolvedValueOnce([]);

    const date = new Date("2025-06-15T00:00:00Z");
    await getDailySummary(date);

    const match = lastAggregateMatch();
    expect(match.direction).toBe("DBIT");
    expect(match.date.$gte).toEqual(date);
    expect(match.date.$lt).toEqual(new Date("2025-06-16T00:00:00Z"));
  });

  it("defaults currency to EUR when null", async () => {
    mockToArray
      .mockResolvedValueOnce([{ totalSpent: 10, totalReceived: 0, currency: null }])
      .mockResolvedValueOnce([]);

    const result = await getDailySummary(new Date("2025-06-15T00:00:00Z"));

    expect(result?.currency).toBe("EUR");
  });
});

describe("getMonthlySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no transactions exist", async () => {
    mockToArray.mockResolvedValueOnce([]);

    const result = await getMonthlySummary(2025, 6);

    expect(result).toBeNull();
  });

  it("returns monthly totals with top counterparties", async () => {
    mockToArray
      .mockResolvedValueOnce([{ totalSpent: 1200, totalReceived: 3000, currency: "EUR" }])
      .mockResolvedValueOnce([
        { name: "Wolt", total: 350 },
        { name: "Rimi", total: 280 },
      ]);

    const result = await getMonthlySummary(2025, 6);

    expect(result).toEqual({
      month: "2025-06",
      totalSpent: 1200,
      totalReceived: 3000,
      currency: "EUR",
      topCounterparties: [
        { name: "Wolt", total: 350 },
        { name: "Rimi", total: 280 },
      ],
    });
  });

  it("uses correct date range for the month", async () => {
    mockToArray.mockResolvedValueOnce([]);

    await getMonthlySummary(2025, 1);

    const match = lastAggregateMatch();
    expect(match.date.$gte).toEqual(new Date(Date.UTC(2025, 0, 1)));
    expect(match.date.$lt).toEqual(new Date(Date.UTC(2025, 1, 1)));
  });

  it("zero-pads single-digit months", async () => {
    mockToArray
      .mockResolvedValueOnce([{ totalSpent: 0, totalReceived: 0, currency: "EUR" }])
      .mockResolvedValueOnce([]);

    const result = await getMonthlySummary(2025, 3);

    expect(result?.month).toBe("2025-03");
  });
});
