import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { startAuth, createSession } from "../api/client.js";
import { sessions } from "../db/collections.js";
import { config, type BankConfig } from "../config.js";
import type { Session } from "../models/session.js";

export async function runAuthFlow(bankId: string): Promise<void> {
  const bank: BankConfig | undefined = config.banks.find((b) => b.id === bankId);
  if (!bank) {
    const available = config.banks.map((b) => b.id).join(", ");
    throw new Error(`Unknown bank "${bankId}". Available: ${available}`);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    console.log(`Starting auth for ${bank.name} (${bank.country})...`);

    const auth = await startAuth(bank.redirectUrl, bank);
    console.log(`\nOpen this URL in your browser:\n${auth.url}\n`);

    const callbackUrl = await rl.question("Paste the full redirect URL after auth: ");
    const url = new URL(callbackUrl.trim());
    const code = url.searchParams.get("code");
    if (!code) throw new Error("No 'code' parameter found in redirect URL");

    console.log("Creating session...");
    const session = await createSession(code, bank);

    const account = session.accounts[0];
    if (!account) throw new Error("No accounts returned from session");

    console.log(`Session created. Account: ${account.iban} (uid: ${account.uid})`);

    const doc: Session = {
      _id: bankId,
      sessionId: session.session_id,
      accountUid: account.uid,
      validUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await sessions().replaceOne({ _id: bankId }, doc, { upsert: true });
    console.log(`Session for ${bank.name} stored in MongoDB.`);
  } finally {
    rl.close();
  }
}
