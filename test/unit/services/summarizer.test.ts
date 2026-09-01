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

const { getDailySummary, getMonthlySummary } = await import("../../../src/services/summarizer.js");

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
      .mockResolvedValueOnce([{ currency: "EUR", spent: 55.0, received: 0 }])
      .mockResolvedValueOnce([
        { counterpartyName: "Wolt", amount: 30, currency: "EUR" },
        { counterpartyName: "Bolt", amount: 25, currency: "EUR" },
      ]);

    const date = new Date("2025-06-15T00:00:00Z");
    const result = await getDailySummary(date);

    expect(result).toEqual({
      date,
      totals: [{ currency: "EUR", spent: 55.0, received: 0 }],
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

  it("keeps one total per currency", async () => {
    mockToArray
      .mockResolvedValueOnce([
        { currency: "EUR", spent: 55.0, received: 0 },
        { currency: "SEK", spent: 300.0, received: 0 },
      ])
      .mockResolvedValueOnce([]);

    const result = await getDailySummary(new Date("2025-06-15T00:00:00Z"));

    expect(result?.totals).toEqual([
      { currency: "EUR", spent: 55.0, received: 0 },
      { currency: "SEK", spent: 300.0, received: 0 },
    ]);
  });

  it("groups totals by currency rather than collapsing them", async () => {
    mockToArray.mockResolvedValueOnce([]);

    await getDailySummary(new Date("2025-06-15T00:00:00Z"));

    const groupStage = mockAggregate.mock.calls[0][0][1].$group as { _id: Document };
    expect(groupStage._id).toEqual({ $ifNull: ["$currency", "EUR"] });
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
      .mockResolvedValueOnce([{ currency: "EUR", spent: 1200, received: 3000 }])
      .mockResolvedValueOnce([
        { name: "Wolt", currency: "EUR", total: 350 },
        { name: "Rimi", currency: "EUR", total: 280 },
      ]);

    const result = await getMonthlySummary(2025, 6);

    expect(result).toEqual({
      month: "2025-06",
      totals: [{ currency: "EUR", spent: 1200, received: 3000 }],
      topCounterparties: [
        { name: "Wolt", currency: "EUR", total: 350 },
        { name: "Rimi", currency: "EUR", total: 280 },
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
      .mockResolvedValueOnce([{ currency: "EUR", spent: 0, received: 0 }])
      .mockResolvedValueOnce([]);

    const result = await getMonthlySummary(2025, 3);

    expect(result?.month).toBe("2025-03");
  });
});
