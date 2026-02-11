import type { BankConfig } from "../src/config.js";
import type { RawTransaction, FetchedTransaction } from "../src/api/client.js";

export const TEST_BANK: BankConfig = {
  id: "test-bank",
  name: "Test Bank",
  country: "EE",
  appId: "app-123",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  redirectUrl: "https://localhost:3000/callback",
};

export function makeRawTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
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

export function makeFetchedTx(overrides: Partial<FetchedTransaction> = {}): FetchedTransaction {
  return {
    hash: "abc123",
    amount: 10,
    currency: "EUR",
    direction: "DBIT",
    date: new Date("2025-06-15"),
    counterpartyName: "Shop",
    counterpartyAccount: null,
    description: "Payment",
    status: "BOOK",
    entryReference: null,
    merchantCategoryCode: null,
    ...overrides,
  };
}

export function makeSession(
  overrides: Partial<{ _id: string; accounts: Array<{ uid: string; iban: string }>; validUntil: string }> = {},
) {
  return {
    _id: "test-bank",
    accounts: [{ uid: "acc1", iban: "EE123" }],
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}
