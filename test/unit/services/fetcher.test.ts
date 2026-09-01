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

const defaultBank = {
  id: "test-bank",
  name: "Test Bank",
  country: "EE",
  appId: "app",
  privateKey: "key",
  redirectUrl: "https://localhost:3000/callback",
};

const mockConfig = {
  banks: [{ ...defaultBank }],
};

vi.mock("../../../src/config.js", () => ({
  config: mockConfig,
}));

const { fetchAndStore } = await import("../../../src/services/fetcher.js");
type SessionAlert = Awaited<ReturnType<typeof fetchAndStore>>[number];

describe("fetchAndStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.banks = [{ ...defaultBank }];
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
    mockFetchTransactions.mockResolvedValueOnce([
      makeFetchedTx(),
      makeFetchedTx({ hash: "def456" }),
    ]);
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
    mockFindOne.mockResolvedValueOnce(makeSession()).mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValue([]);
    mockFetchTransactions
      .mockRejectedValueOnce(new Error("ASPSP_ERROR"))
      .mockResolvedValueOnce([makeFetchedTx()]);
    mockInsertOne.mockResolvedValueOnce({});

    await fetchAndStore();

    expect(mockFetchTransactions).toHaveBeenCalledTimes(2);
    expect(mockInsertOne).toHaveBeenCalledOnce();
  });

  it("fetches from 7 days before latest transaction when history exists", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([{ date: "2025-06-15" }]);
    mockFetchTransactions.mockResolvedValueOnce([]);

    await fetchAndStore();

    const dateFrom = mockFetchTransactions.mock.calls[0][1] as string;
    expect(dateFrom).toBe("2025-06-08");
  });

  it("uses max lookback when fullLookback is true, ignoring history", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([{ date: "2025-06-15" }]);
    mockFetchTransactions.mockResolvedValueOnce([]);

    await fetchAndStore(true);

    const dateFrom = mockFetchTransactions.mock.calls[0][1] as string;
    expect(dateFrom).not.toBe("2025-06-08");
    const daysAgo = (Date.now() - new Date(dateFrom).getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(300);
  });

  it("retries with corrected date on 422 WRONG_TRANSACTIONS_PERIOD", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([]);
    const periodError = new Error(
      'API GET /accounts/uid/transactions failed (422): {"code":422,"message":"Wrong transactions period requested","detail":{"message":"You can not request transactions more than 90 days in the past","date_from":"2025-11-17"},"error":"WRONG_TRANSACTIONS_PERIOD"}',
    );
    mockFetchTransactions
      .mockRejectedValueOnce(periodError)
      .mockResolvedValueOnce([makeFetchedTx()]);
    mockInsertOne.mockResolvedValueOnce({});

    await fetchAndStore();

    expect(mockFetchTransactions).toHaveBeenCalledTimes(2);
    expect(mockFetchTransactions.mock.calls[1][1]).toBe("2025-11-17");
    expect(mockInsertOne).toHaveBeenCalledOnce();
  });

  it("rethrows non-period errors without retry", async () => {
    mockFindOne.mockResolvedValueOnce(makeSession());
    mockToArray.mockResolvedValueOnce([]);
    mockFetchTransactions.mockRejectedValueOnce(new Error("failed (500): Internal Server Error"));

    await expect(fetchAndStore()).rejects.toThrow("All banks failed");
    expect(mockFetchTransactions).toHaveBeenCalledTimes(1);
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

describe("session alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.banks = [{ ...defaultBank }];
  });

  it("reports a missing session", async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const alerts = await fetchAndStore();

    expect(alerts).toEqual([
      { bankId: "test-bank", bankName: "Test Bank", status: "missing", daysLeft: 0 },
    ]);
  });

  it("reports an expired session", async () => {
    mockFindOne.mockResolvedValueOnce(
      makeSession({ validUntil: new Date(Date.now() - 1000).toISOString() }),
    );

    const alerts = await fetchAndStore();

    expect(alerts).toEqual([
      { bankId: "test-bank", bankName: "Test Bank", status: "expired", daysLeft: 0 },
    ]);
  });

  it("warns about a session expiring soon but still fetches", async () => {
    mockFindOne.mockResolvedValueOnce(
      makeSession({ validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
    );
    mockToArray.mockResolvedValueOnce([]);
    mockFetchTransactions.mockResolvedValueOnce([]);

    const alerts = await fetchAndStore();

    expect(alerts).toEqual([
      { bankId: "test-bank", bankName: "Test Bank", status: "expiring", daysLeft: 3 },
    ]);
    expect(mockFetchTransactions).toHaveBeenCalledOnce();
  });

  it("stays quiet when the session is comfortably valid", async () => {
    mockFindOne.mockResolvedValueOnce(
      makeSession({ validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString() }),
    );
    mockToArray.mockResolvedValueOnce([]);
    mockFetchTransactions.mockResolvedValueOnce([]);

    const alerts = await fetchAndStore();

    expect(alerts).toEqual([]);
  });

  it("reports each bank separately", async () => {
    mockConfig.banks = [
      { id: "bank-a", name: "Bank A", country: "EE", appId: "a", privateKey: "k", redirectUrl: "" },
      { id: "bank-b", name: "Bank B", country: "EE", appId: "b", privateKey: "k", redirectUrl: "" },
    ];
    mockFindOne
      .mockResolvedValueOnce(makeSession({ validUntil: new Date(Date.now() - 1000).toISOString() }))
      .mockResolvedValueOnce(
        makeSession({ validUntil: new Date(Date.now() + 86_400_000).toISOString() }),
      );
    mockToArray.mockResolvedValue([]);
    mockFetchTransactions.mockResolvedValueOnce([]);

    const alerts = await fetchAndStore();

    expect(alerts.map((a) => [a.bankId, a.status, a.daysLeft])).toEqual([
      ["bank-a", "expired", 0],
      ["bank-b", "expiring", 1],
    ]);
  });
});

describe("session alerts on fetch failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.banks = [{ ...defaultBank }];
  });

  it("keeps the alert when that bank's fetch throws", async () => {
    mockConfig.banks = [
      { id: "bank-a", name: "Bank A", country: "EE", appId: "a", privateKey: "k", redirectUrl: "" },
      { id: "bank-b", name: "Bank B", country: "EE", appId: "b", privateKey: "k", redirectUrl: "" },
    ];
    mockFindOne
      .mockResolvedValueOnce(
        makeSession({ validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
      )
      .mockResolvedValueOnce(
        makeSession({ validUntil: new Date(Date.now() + 90 * 86_400_000).toISOString() }),
      );
    mockToArray.mockResolvedValue([]);
    mockFetchTransactions
      .mockRejectedValueOnce(new Error("upstream boom"))
      .mockResolvedValueOnce([]);

    const alerts = await fetchAndStore();

    expect(alerts).toEqual([
      { bankId: "bank-a", bankName: "Bank A", status: "expiring", daysLeft: 3 },
    ]);
  });

  it("keeps alerts when every bank fails", async () => {
    mockFindOne.mockResolvedValueOnce(
      makeSession({ validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
    );
    mockToArray.mockResolvedValue([]);
    mockFetchTransactions.mockRejectedValueOnce(new Error("upstream boom"));

    const alerts: SessionAlert[] = [];
    await expect(fetchAndStore(false, alerts)).rejects.toThrow("All banks failed to fetch");

    expect(alerts).toEqual([
      { bankId: "test-bank", bankName: "Test Bank", status: "expiring", daysLeft: 3 },
    ]);
  });
});
