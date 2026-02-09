import { createHash } from "node:crypto";
import { generateJwt } from "./jwt.js";
import type { BankConfig } from "../config.js";
import {
  EB_API_BASE_URL,
  EB_REQUEST_TIMEOUT_MS,
  EB_SESSION_VALIDITY_MS,
  EB_MAX_PAGINATION_PAGES,
} from "../constants.js";

async function request<T>(
  method: string,
  path: string,
  bank: BankConfig,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${EB_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${generateJwt(bank.appId, bank.privateKey)}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(EB_REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

interface AuthResponse {
  url: string;
}

export async function startAuth(redirectUrl: string, bank: BankConfig): Promise<AuthResponse> {
  return request<AuthResponse>("POST", "/auth", bank, {
    access: {
      valid_until: new Date(Date.now() + EB_SESSION_VALIDITY_MS).toISOString(),
    },
    aspsp: { name: bank.name, country: bank.country },
    state: "auth",
    redirect_url: redirectUrl,
    psu_type: "personal",
  });
}

interface SessionResponse {
  session_id: string;
  accounts: Array<{ uid: string; iban: string }>;
}

export async function createSession(code: string, bank: BankConfig): Promise<SessionResponse> {
  return request<SessionResponse>("POST", "/sessions", bank, { code });
}

export interface RawTransaction {
  entry_reference: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "DBIT" | "CRDT";
  status: string;
  booking_date: string | null;
  value_date: string | null;
  transaction_date: string | null;
  creditor: { name: string } | null;
  debtor: { name: string } | null;
  creditor_account: { iban: string } | null;
  debtor_account: { iban: string } | null;
  remittance_information: string[] | null;
  merchant_category_code: string | null;
  bank_transaction_code: string | null;
}

interface TransactionsResponse {
  transactions: RawTransaction[];
  continuation_key?: string;
}

export interface FetchedTransaction {
  hash: string;
  amount: number;
  currency: string;
  direction: "DBIT" | "CRDT";
  date: Date;
  counterpartyName: string;
  description: string;
  status: string;
}

export function hashTransaction(tx: RawTransaction): string {
  const desc = tx.remittance_information?.join(" ") ?? "";
  const key = `${tx.value_date ?? tx.booking_date}|${tx.transaction_amount.amount}|${tx.transaction_amount.currency}|${tx.credit_debit_indicator}|${desc}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export function extractCounterparty(tx: RawTransaction): string {
  if (tx.credit_debit_indicator === "DBIT" && tx.creditor?.name) return tx.creditor.name;
  if (tx.credit_debit_indicator === "CRDT" && tx.debtor?.name) return tx.debtor.name;
  const desc = tx.remittance_information?.join(" ") ?? "";

  const cardWithCode = desc.match(/\(\d+\)\s+(.+)/);
  if (cardWithCode) return cardWithCode[1]!.trim();

  const cardNoCode = desc.match(/\d{6}\*+\d{4}\s+\d{2}\.\d{2}\.\d{2}\s+(.+)/);
  if (cardNoCode) {
    return cardNoCode[1]!.replace(/\s+\d{5}\s+\w+$/, "").trim();
  }

  return desc || "Unknown";
}

export async function fetchTransactions(
  accountUid: string,
  dateFrom: string,
  dateTo: string,
  bank: BankConfig,
): Promise<FetchedTransaction[]> {
  const MAX_PAGES = EB_MAX_PAGINATION_PAGES;
  const all: FetchedTransaction[] = [];
  let continuationKey: string | undefined;
  let page = 0;

  do {
    if (++page > MAX_PAGES) {
      console.warn(`Pagination limit (${MAX_PAGES}) reached for account ${accountUid}, stopping.`);
      break;
    }
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (continuationKey) params.set("continuation_key", continuationKey);

    const data = await request<TransactionsResponse>(
      "GET",
      `/accounts/${accountUid}/transactions?${params}`,
      bank,
    );

    for (const tx of data.transactions) {
      const rawDate = tx.value_date ?? tx.booking_date;
      const date = rawDate ? new Date(rawDate) : null;
      if (!date || isNaN(date.getTime())) {
        console.warn(`Skipping transaction with invalid date: ${rawDate ?? "null"}`, tx.entry_reference);
        continue;
      }

      all.push({
        hash: hashTransaction(tx),
        amount: parseFloat(tx.transaction_amount.amount),
        currency: tx.transaction_amount.currency,
        direction: tx.credit_debit_indicator,
        date,
        counterpartyName: extractCounterparty(tx),
        description: tx.remittance_information?.join(" ") ?? "",
        status: tx.status,
      });
    }

    continuationKey = data.continuation_key;
  } while (continuationKey);

  return all;
}
