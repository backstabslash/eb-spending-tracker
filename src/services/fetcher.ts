import { fetchTransactions } from "../api/client.js";
import { sessions, transactions } from "../db/collections.js";
import { config, type BankConfig } from "../config.js";
import { FETCH_MAX_LOOKBACK_DAYS, FETCH_OVERLAP_DAYS } from "../constants.js";
import type { Transaction } from "../models/transaction.js";

async function getDateFrom(bankId: string): Promise<string> {
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

  return new Date(Date.now() - FETCH_MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

async function fetchBank(bank: BankConfig): Promise<{ fetched: number; newCount: number }> {
  const session = await sessions().findOne({ _id: bank.id });
  if (!session) {
    console.warn(`No session for ${bank.name} (${bank.id}). Run 'auth ${bank.id}' first.`);
    return { fetched: 0, newCount: 0 };
  }

  if (new Date(session.validUntil) < new Date()) {
    console.warn(`Session expired for ${bank.name} (${bank.id}). Run 'auth ${bank.id}'.`);
    return { fetched: 0, newCount: 0 };
  }

  const accountUids = session.accounts.map((a) => a.uid);
  if (accountUids.length === 0) {
    console.warn(`[${bank.name}] No accounts in session. Run 'auth ${bank.id}'.`);
    return { fetched: 0, newCount: 0 };
  }

  const dateTo = new Date().toISOString().split("T")[0];
  const dateFrom = await getDateFrom(bank.id);
  let totalFetched = 0;
  let totalNew = 0;

  for (const accountUid of accountUids) {
    console.log(
      `[${bank.name}] Fetching transactions for account ${accountUid} from ${dateFrom} to ${dateTo}...`,
    );
    const raw = await fetchTransactions(accountUid, dateFrom, dateTo, bank);

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

export async function fetchAndStore(): Promise<void> {
  const errors: Array<{ bank: string; error: unknown }> = [];

  for (const bank of config.banks) {
    try {
      await fetchBank(bank);
    } catch (err: unknown) {
      console.error(`[${bank.name}] Failed to fetch:`, err);
      errors.push({ bank: bank.name, error: err });
    }
  }

  if (errors.length === config.banks.length) {
    throw new Error(`All banks failed to fetch: ${errors.map((e) => e.bank).join(", ")}`);
  }
}
