import { fetchTransactions } from "../api/client.js";
import { sessions, transactions } from "../db/collections.js";
import { config, type BankConfig } from "../config.js";
import type { Transaction } from "../models/transaction.js";

const MAX_LOOKBACK_DAYS = 365;
const OVERLAP_DAYS = 7;

async function getDateFrom(bankId: string): Promise<string> {
  const latest = await transactions()
    .find({ source: bankId })
    .sort({ date: -1 })
    .limit(1)
    .toArray();

  if (latest.length > 0 && latest[0]) {
    const from = new Date(latest[0].date);
    from.setUTCDate(from.getUTCDate() - OVERLAP_DAYS);
    return from.toISOString().split("T")[0]!;
  }

  return new Date(Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;
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

  const dateTo = new Date().toISOString().split("T")[0]!;
  const dateFrom = await getDateFrom(bank.id);

  console.log(`[${bank.name}] Fetching transactions from ${dateFrom} to ${dateTo}...`);
  const raw = await fetchTransactions(session.accountUid, dateFrom, dateTo, bank);

  let newCount = 0;
  for (const tx of raw) {
    const doc: Transaction = {
      _id: tx.hash,
      amount: tx.amount,
      currency: tx.currency,
      direction: tx.direction,
      date: tx.date,
      counterpartyName: tx.counterpartyName,
      description: tx.description,
      status: tx.status,
      source: bank.id,
    };

    try {
      await transactions().insertOne(doc);
      newCount++;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code: number }).code === 11000) {
        continue;
      }
      throw err;
    }
  }

  console.log(`[${bank.name}] Fetched ${raw.length} transactions, ${newCount} new.`);
  return { fetched: raw.length, newCount };
}

export async function fetchAndStore(): Promise<void> {
  for (const bank of config.banks) {
    await fetchBank(bank);
  }
}
