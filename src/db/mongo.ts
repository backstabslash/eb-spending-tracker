import { MongoClient } from "mongodb";
import { config } from "../config.js";

let client: MongoClient | null = null;

export async function connect(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(config.mongoUri);
    await client.connect();
  }
  return client;
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export function getDb() {
  if (!client) throw new Error("MongoDB not connected");
  return client.db(config.mongoDbName);
}
