import { fetchTransactions } from "../api/client.js";
import { sessions, transactions } from "../db/collections.js";
import { config, type BankConfig } from "../config.js";
import {
  FETCH_MAX_LOOKBACK_DAYS,
  FETCH_OVERLAP_DAYS,
  MS_PER_DAY,
  SESSION_EXPIRY_WARNING_DAYS,
} from "../constants.js";
import type { Transaction } from "../models/transaction.js";

export interface SessionAlert {
  bankId: string;
  bankName: string;
  status: "missing" | "expired" | "expiring";
  daysLeft: number;
}

function parseTransactionPeriodError(err: unknown): string | null {
  if (!(err instanceof Error)) {
    return null;
  }
  const match = err.message.match(/"date_from"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  return match?.[1] ?? null;
}

function maxLookbackDate(): string {
  return new Date(Date.now() - FETCH_MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

async function getDateFrom(bankId: string, fullLookback: boolean): Promise<string> {
  if (fullLookback) {
    return maxLookbackDate();
  }

  const latest = await transactions()
    .find({ source: bankId })
    .sort({ date: -1 })
    .limit(1)
    .toArray();

  if (latest.length > 0 && latest[0]) {
    const from = new Date(latest[0].date);
    from.setUTCDate(from.getUTCDate() - FETCH_OVERLAP_DAYS);
    return from.toISOString().split("T")[0];
  }

  return maxLookbackDate();
}

async function fetchBank(
  bank: BankConfig,
  fullLookback: boolean,
  dateTo: string,
  alerts: SessionAlert[],
): Promise<{ fetched: number; newCount: number }> {
  const pushAlert = (status: SessionAlert["status"], daysLeft: number): void => {
    alerts.push({ bankId: bank.id, bankName: bank.name, status, daysLeft });
  };

  const session = await sessions().findOne({ _id: bank.id });
  if (!session) {
    console.warn(`No session for ${bank.name} (${bank.id}). Run 'auth ${bank.id}' first.`);
    pushAlert("missing", 0);
    return { fetched: 0, newCount: 0 };
  }

  const msLeft = new Date(session.validUntil).getTime() - Date.now();
  if (msLeft <= 0) {
    console.warn(`Session expired for ${bank.name} (${bank.id}). Run 'auth ${bank.id}'.`);
    pushAlert("expired", 0);
    return { fetched: 0, newCount: 0 };
  }

  const daysLeft = Math.ceil(msLeft / MS_PER_DAY);
  if (daysLeft <= SESSION_EXPIRY_WARNING_DAYS) {
    console.warn(`Session for ${bank.name} (${bank.id}) expires in ${daysLeft} day(s).`);
    pushAlert("expiring", daysLeft);
  }

  const accountUids = session.accounts.map((a) => a.uid);
  if (accountUids.length === 0) {
    console.warn(`[${bank.name}] No accounts in session. Run 'auth ${bank.id}'.`);
    pushAlert("missing", 0);
    return { fetched: 0, newCount: 0 };
  }

  let dateFrom = await getDateFrom(bank.id, fullLookback);
  let totalFetched = 0;
  let totalNew = 0;

  for (const accountUid of accountUids) {
    console.log(
      `[${bank.name}] Fetching transactions for account ${accountUid} from ${dateFrom} to ${dateTo}...`,
    );
    let raw: Awaited<ReturnType<typeof fetchTransactions>>;
    try {
      raw = await fetchTransactions(accountUid, dateFrom, dateTo, bank);
    } catch (err: unknown) {
      const corrected = parseTransactionPeriodError(err);
      if (corrected) {
        console.warn(`[${bank.name}] Date too early, retrying from ${corrected}...`);
        dateFrom = corrected;
        raw = await fetchTransactions(accountUid, dateFrom, dateTo, bank);
      } else {
        throw err;
      }
    }

    for (const tx of raw) {
      const doc: Transaction = {
        _id: tx.hash,
        amount: tx.amount,
        currency: tx.currency,
        direction: tx.direction,
        date: tx.date,
        counterpartyName: tx.counterpartyName,
        counterpartyAccount: tx.counterpartyAccount,
        description: tx.description,
        status: tx.status,
        source: bank.id,
        entryReference: tx.entryReference,
        merchantCategoryCode: tx.merchantCategoryCode,
      };

      try {
        await transactions().insertOne(doc);
        totalNew++;
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as { code: number }).code === 11000) {
          continue;
        }
        throw err;
      }
    }

    totalFetched += raw.length;
  }

  console.log(
    `[${bank.name}] Fetched ${totalFetched} transactions across ${accountUids.length} account(s), ${totalNew} new.`,
  );
  return { fetched: totalFetched, newCount: totalNew };
}

export async function fetchAndStore(
  fullLookback = false,
  alerts: SessionAlert[] = [],
): Promise<SessionAlert[]> {
  if (fullLookback) {
    console.log("Full lookback enabled, fetching max history.");
  }

  const dateTo = new Date().toISOString().split("T")[0];
  const errors: Array<{ bank: string; error: unknown }> = [];

  for (const bank of config.banks) {
    try {
      await fetchBank(bank, fullLookback, dateTo, alerts);
    } catch (err: unknown) {
      console.error(`[${bank.name}] Failed to fetch:`, err);
      errors.push({ bank: bank.name, error: err });
    }
  }

  if (errors.length === config.banks.length) {
    throw new Error(`All banks failed to fetch: ${errors.map((e) => e.bank).join(", ")}`);
  }

  return alerts;
}
