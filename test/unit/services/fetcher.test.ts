import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFetchedTx, makeSession } from "../../fixtures.js";

const mockFindOne = vi.fn();
const mockInsertOne = vi.fn();
const mockToArray = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray });
const mockSort = vi.fn().mockReturnValue({ limit: mockLimit });
const mockFind = vi.fn().mockReturnValue({ sort: mockSort });

const mockFetchTransactions = vi.fn();

vi.mock("../../../src/db/collections.js", () => ({
  sessions: () => ({ findOne: mockFindOne }),
  transactions: () => ({ find: mockFind, insertOne: mockInsertOne }),
}));

vi.mock("../../../src/api/client.js", () => ({
  fetchTransactions: (...args: unknown[]) => mockFetchTransactions(...args),
}));

const mockConfig = {
  banks: [
    {
      id: "test-bank",
      name: "Test Bank",
      country: "EE",
      appId: "app",
      privateKey: "key",
      redirectUrl: "https://localhost:3000/callback",
    },
  ],
};

vi.mock("../../../src/config.js", () => ({
  config: mockConfig,
}));

const { fetchAndStore } = await import("../../../src/services/fetcher.js");

describe("fetchAndStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips bank when no session exists", async () => {
    mockFindOne.mockResolvedValueOnce(null);

    await fetchAndStore();

    expect(mockFetchTransactions).not.toHaveBeenCalled();
  });

  it("skips bank when session is expired", async () => {
    mockFindOne.mockResolvedValueOnce(
      makeSession({ validUntil: new Date(Date.now() - 1000).toISOString() }),
    );

    await fetchAndStore();

    expect(mockFetchTransactions).not.toHaveBeenCalled();
  });

  it("skips bank when session has no accounts", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession({ accounts: [] }));

    await fetchAndStore();

    expect(mockFetchTransactions).not.toHaveBeenCalled();
  });

  it("fetches and inserts new transactions", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([]);
    mockFetchTransactions.mockResolvedValueOnce([makeFetchedTx()]);
    mockInsertOne.mockResolvedValueOnce({});

    await fetchAndStore();

    expect(mockFetchTransactions).toHaveBeenCalledOnce();
    expect(mockInsertOne).toHaveBeenCalledOnce();
    expect(mockInsertOne.mock.calls[0][0]).toMatchObject({
      _id: "abc123",
      amount: 10,
      source: "test-bank",
    });
  });

  it("silently skips duplicate transactions (error code 11000)", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([]);
    mockFetchTransactions.mockResolvedValueOnce([makeFetchedTx(), makeFetchedTx({ hash: "def456" })]);
    const dupError = Object.assign(new Error("dup key"), { code: 11000 });
    mockInsertOne.mockRejectedValueOnce(dupError).mockResolvedValueOnce({});

    await fetchAndStore();

    expect(mockInsertOne).toHaveBeenCalledTimes(2);
  });

  it("throws when all banks fail", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([]);
    mockFetchTransactions.mockResolvedValueOnce([makeFetchedTx()]);
    mockInsertOne.mockRejectedValueOnce(new Error("connection lost"));

    await expect(fetchAndStore()).rejects.toThrow("All banks failed");
  });

  it("continues to next bank when one fails", async () => {
    mockConfig.banks = [
      { id: "bank-a", name: "Bank A", country: "EE", appId: "a", privateKey: "k", redirectUrl: "" },
      { id: "bank-b", name: "Bank B", country: "EE", appId: "b", privateKey: "k", redirectUrl: "" },
    ];
    mockFindOne
      .mockResolvedValueOnce(makeSession())
      .mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValue([]);
    mockFetchTransactions
      .mockRejectedValueOnce(new Error("ASPSP_ERROR"))
      .mockResolvedValueOnce([makeFetchedTx()]);
    mockInsertOne.mockResolvedValueOnce({});

    await fetchAndStore();

    expect(mockFetchTransactions).toHaveBeenCalledTimes(2);
    expect(mockInsertOne).toHaveBeenCalledOnce();

    mockConfig.banks = [
      { id: "test-bank", name: "Test Bank", country: "EE", appId: "app", privateKey: "key", redirectUrl: "https://localhost:3000/callback" },
    ];
  });

  it("fetches from 7 days before latest transaction when history exists", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([{ date: "2025-06-15" }]);
    mockFetchTransactions.mockResolvedValueOnce([]);

    await fetchAndStore();

    const dateFrom = mockFetchTransactions.mock.calls[0][1] as string;
    expect(dateFrom).toBe("2025-06-08");
  });

  it("iterates over multiple accounts in a session", async () => {
    mockFindOne.mockResolvedValueOnce(
      makeSession({
        accounts: [
          { uid: "acc1", iban: "EE111" },
          { uid: "acc2", iban: "EE222" },
        ],
      }),
    );
    mockToArray.mockResolvedValue([]);
    mockFetchTransactions.mockResolvedValue([]);

    await fetchAndStore();

    expect(mockFetchTransactions).toHaveBeenCalledTimes(2);
    expect(mockFetchTransactions.mock.calls[0][0]).toBe("acc1");
    expect(mockFetchTransactions.mock.calls[1][0]).toBe("acc2");
  });
});
