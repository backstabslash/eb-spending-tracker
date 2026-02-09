import type { Collection } from "mongodb";
import { getDb } from "./mongo.js";
import type { Transaction } from "../models/transaction.js";
import type { Session } from "../models/session.js";

export function transactions(): Collection<Transaction> {
  return getDb().collection<Transaction>("transactions");
}

export function sessions(): Collection<Session> {
  return getDb().collection<Session>("sessions");
}

export async function ensureIndexes(): Promise<void> {
  await transactions().createIndex({ date: -1 });
  await transactions().createIndex({ source: 1 });
  await transactions().updateMany({ date: { $type: "string" } }, [
    { $set: { date: { $dateFromString: { dateString: "$date" } } } },
  ]);
}
