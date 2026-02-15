import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashTransaction, extractCounterparty, fetchTransactions } from "../../../src/api/client.js";
import { makeRawTx, TEST_BANK } from "../../fixtures.js";

vi.mock("../../../src/api/jwt.js", () => ({
  generateJwt: () => "mock-jwt-token",
}));

describe("hashTransaction", () => {
  it("is deterministic", () => {
    const tx = makeRawTx();
    expect(hashTransaction(tx)).toBe(hashTransaction(tx));
  });

  it("produces 24 hex chars", () => {
    const hash = hashTransaction(makeRawTx());
    expect(hash).toMatch(/^[0-9a-f]{24}$/);
  });

  it("changes with different amount", () => {
    const h1 = hashTransaction(makeRawTx());
    const h2 = hashTransaction(makeRawTx({ transaction_amount: { amount: "20.00", currency: "EUR" } }));
    expect(h1).not.toBe(h2);
  });

  it("changes with different date", () => {
    const h1 = hashTransaction(makeRawTx());
    const h2 = hashTransaction(makeRawTx({ value_date: "2025-06-16" }));
    expect(h1).not.toBe(h2);
  });

  it("changes with different direction", () => {
    const h1 = hashTransaction(makeRawTx());
    const h2 = hashTransaction(makeRawTx({ credit_debit_indicator: "CRDT" }));
    expect(h1).not.toBe(h2);
  });

  it("changes with different description", () => {
    const h1 = hashTransaction(makeRawTx());
    const h2 = hashTransaction(makeRawTx({ remittance_information: ["Other payment"] }));
    expect(h1).not.toBe(h2);
  });

  it("prefers value_date over booking_date", () => {
    const h1 = hashTransaction(makeRawTx({ value_date: "2025-06-15", booking_date: "2025-06-14" }));
    const h2 = hashTransaction(makeRawTx({ value_date: "2025-06-15", booking_date: "2025-06-16" }));
    expect(h1).toBe(h2);
  });

  it("uses entry_reference when available", () => {
    const h1 = hashTransaction(makeRawTx({ entry_reference: "REF123", remittance_information: ["desc A"] }));
    const h2 = hashTransaction(makeRawTx({ entry_reference: "REF123", remittance_information: ["desc B"] }));
    expect(h1).toBe(h2);
  });

  it("different entry_references produce different hashes", () => {
    const h1 = hashTransaction(makeRawTx({ entry_reference: "REF123" }));
    const h2 = hashTransaction(makeRawTx({ entry_reference: "REF456" }));
    expect(h1).not.toBe(h2);
  });

  it("normalizes whitespace in description fallback", () => {
    const h1 = hashTransaction(makeRawTx({ remittance_information: ["MAXIMA/MADALA 5 10313 TALLINN"] }));
    const h2 = hashTransaction(makeRawTx({ remittance_information: ["MAXIMA/MADALA 5  10313  TALLINN  "] }));
    expect(h1).toBe(h2);
  });
});

describe("extractCounterparty", () => {
  it("returns creditor name for DBIT", () => {
    const tx = makeRawTx({ credit_debit_indicator: "DBIT", creditor: { name: "Shop" } });
    expect(extractCounterparty(tx)).toBe("Shop");
  });

  it("returns debtor name for CRDT", () => {
    const tx = makeRawTx({ credit_debit_indicator: "CRDT", debtor: { name: "Employer" } });
    expect(extractCounterparty(tx)).toBe("Employer");
  });

  it("extracts name from card-with-code pattern", () => {
    const tx = makeRawTx({
      creditor: null,
      remittance_information: [
        "OST 400000******1234 01.01.25 12:00 10.00 EUR (100001) Coffee Shop AB",
      ],
    });
    expect(extractCounterparty(tx)).toBe("Coffee Shop AB");
  });

  it("extracts name from card-no-code pattern", () => {
    const tx = makeRawTx({
      creditor: null,
      remittance_information: [
        "400000******1234 01.01.25 DOWNTOWN GROCERY 10001 METROPOLIS",
      ],
    });
    expect(extractCounterparty(tx)).toBe("DOWNTOWN GROCERY");
  });

  it("falls back to description", () => {
    const tx = makeRawTx({ creditor: null, remittance_information: ["Some wire transfer"] });
    expect(extractCounterparty(tx)).toBe("Some wire transfer");
  });

  it("falls back to Unknown when no info", () => {
    const tx = makeRawTx({ creditor: null, remittance_information: null });
    expect(extractCounterparty(tx)).toBe("Unknown");
  });
});

describe("fetchTransactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("maps API response to FetchedTransaction[]", async () => {
    const tx = makeRawTx({ creditor: { name: "Shop" }, creditor_account: { iban: "EE123" } });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ transactions: [tx] }), { status: 200 }),
    );

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      amount: 10,
      currency: "EUR",
      direction: "DBIT",
      counterpartyName: "Shop",
      counterpartyAccount: "EE123",
      description: "Test payment",
      status: "BOOK",
      entryReference: null,
      merchantCategoryCode: null,
    });
    expect(result[0].hash).toMatch(/^[0-9a-f]{24}$/);
    expect(result[0].date).toBeInstanceOf(Date);
  });

  it("sends transaction_status=BOOK in query params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ transactions: [] }), { status: 200 }),
    );

    await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK);

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("transaction_status=BOOK");
  });

  it("handles pagination via continuation_key", async () => {
    const tx1 = makeRawTx({ remittance_information: ["Page 1"] });
    const tx2 = makeRawTx({ remittance_information: ["Page 2"] });

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

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK);
    expect(result).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);

    const secondUrl = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(secondUrl).toContain("continuation_key=page2");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK),
    ).rejects.toThrow("failed (401)");
  });

  it("sends PSU headers with transaction requests", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ transactions: [] }), { status: 200 }),
    );

    await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK);

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["Psu-Ip-Address"]).toBe("127.0.0.1");
    expect(headers["Psu-User-Agent"]).toBe("eb-spending-tracker/1.0");
  });

  it("continues polling on empty pages with continuation_key", async () => {
    const tx = makeRawTx();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ transactions: [], continuation_key: "wait1" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transactions: [tx] }), { status: 200 }),
      );

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it("skips transactions with invalid dates", async () => {
    const validTx = makeRawTx({ creditor: { name: "Shop" } });
    const invalidTx = makeRawTx({ value_date: null, booking_date: null });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ transactions: [validTx, invalidTx] }), { status: 200 }),
    );

    const result = await fetchTransactions("acc-uid", "2025-06-01", "2025-06-15", TEST_BANK);
    expect(result).toHaveLength(1);
    expect(result[0].counterpartyName).toBe("Shop");
  });
});
