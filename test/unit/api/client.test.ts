import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashTransaction, extractCounterparty, fetchTransactions } from "../../../src/api/client.js";
import type { RawTransaction } from "../../../src/api/client.js";
import type { BankConfig } from "../../../src/config.js";

vi.mock("../../../src/api/jwt.js", () => ({
  generateJwt: () => "mock-jwt-token",
}));

function makeTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    entry_reference: null,
    transaction_amount: { amount: "10.00", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2025-06-15",
    value_date: "2025-06-15",
    transaction_date: null,
    creditor: null,
    debtor: null,
    creditor_account: null,
    debtor_account: null,
    remittance_information: ["Test payment"],
    merchant_category_code: null,
    bank_transaction_code: null,
    ...overrides,
  };
}

const mockBank: BankConfig = {
  id: "test",
  name: "Test",
  country: "EE",
  appId: "app",
  privateKey: "key",
  redirectUrl: "https://localhost:3000/callback",
};

describe("hashTransaction", () => {
  it("is deterministic", () => {
    const tx = makeTx();
    expect(hashTransaction(tx)).toBe(hashTransaction(tx));
  });

  it("produces 24 hex chars", () => {
    const hash = hashTransaction(makeTx());
    expect(hash).toMatch(/^[0-9a-f]{24}$/);
  });

  it("changes with different amount", () => {
    const h1 = hashTransaction(makeTx());
    const h2 = hashTransaction(makeTx({ transaction_amount: { amount: "20.00", currency: "EUR" } }));
    expect(h1).not.toBe(h2);
  });

  it("changes with different date", () => {
    const h1 = hashTransaction(makeTx());
    const h2 = hashTransaction(makeTx({ value_date: "2025-06-16" }));
    expect(h1).not.toBe(h2);
  });

  it("changes with different direction", () => {
    const h1 = hashTransaction(makeTx());
    const h2 = hashTransaction(makeTx({ credit_debit_indicator: "CRDT" }));
    expect(h1).not.toBe(h2);
  });

  it("changes with different description", () => {
    const h1 = hashTransaction(makeTx());
    const h2 = hashTransaction(makeTx({ remittance_information: ["Other payment"] }));
    expect(h1).not.toBe(h2);
  });

  it("prefers value_date over booking_date", () => {
    const h1 = hashTransaction(makeTx({ value_date: "2025-06-15", booking_date: "2025-06-14" }));
    const h2 = hashTransaction(makeTx({ value_date: "2025-06-15", booking_date: "2025-06-16" }));
    expect(h1).toBe(h2);
  });
});

describe("extractCounterparty", () => {
  it("returns creditor name for DBIT", () => {
    const tx = makeTx({ credit_debit_indicator: "DBIT", creditor: { name: "Shop" } });
    expect(extractCounterparty(tx)).toBe("Shop");
  });

  it("returns debtor name for CRDT", () => {
    const tx = makeTx({ credit_debit_indicator: "CRDT", debtor: { name: "Employer" } });
    expect(extractCounterparty(tx)).toBe("Employer");
  });

  it("extracts name from card-with-code pattern", () => {
    const tx = makeTx({
      creditor: null,
      remittance_information: [
        "OST 400000******1234 01.01.25 12:00 10.00 EUR (100001) Coffee Shop AB",
      ],
    });
    expect(extractCounterparty(tx)).toBe("Coffee Shop AB");
  });

  it("extracts name from card-no-code pattern", () => {
    const tx = makeTx({
      creditor: null,
      remittance_information: [
        "400000******1234 01.01.25 DOWNTOWN GROCERY 10001 METROPOLIS",
      ],
    });
    expect(extractCounterparty(tx)).toBe("DOWNTOWN GROCERY");
  });

  it("falls back to description", () => {
    const tx = makeTx({ creditor: null, remittance_information: ["Some wire transfer"] });
    expect(extractCounterparty(tx)).toBe("Some wire transfer");
  });

  it("falls back to Unknown when no info", () => {
    const tx = makeTx({ creditor: null, remittance_information: null });
    expect(extractCounterparty(tx)).toBe("Unknown");
  });
});

describe("fetchTransactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("maps API response to FetchedTransaction[]", async () => {
    const tx = makeTx({ creditor: { name: "Shop" } });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ transactions: [tx] }), { status: 200 }),
    );

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", mockBank);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      amount: 10,
      currency: "EUR",
      direction: "DBIT",
      counterpartyName: "Shop",
      description: "Test payment",
      status: "BOOK",
    });
    expect(result[0]!.hash).toMatch(/^[0-9a-f]{24}$/);
    expect(result[0]!.date).toBeInstanceOf(Date);
  });

  it("handles pagination via continuation_key", async () => {
    const tx1 = makeTx({ remittance_information: ["Page 1"] });
    const tx2 = makeTx({ remittance_information: ["Page 2"] });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ transactions: [tx1], continuation_key: "page2" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transactions: [tx2] }), { status: 200 }),
      );

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", mockBank);
    expect(result).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);

    const secondUrl = vi.mocked(fetch).mock.calls[1]![0] as string;
    expect(secondUrl).toContain("continuation_key=page2");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", mockBank),
    ).rejects.toThrow("failed (401)");
  });

  it("skips transactions with invalid dates", async () => {
    const validTx = makeTx({ creditor: { name: "Shop" } });
    const invalidTx = makeTx({ value_date: null, booking_date: null });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ transactions: [validTx, invalidTx] }), { status: 200 }),
    );

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", mockBank);
    expect(result).toHaveLength(1);
    expect(result[0]!.counterpartyName).toBe("Shop");
  });
});
