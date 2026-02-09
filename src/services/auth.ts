import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { startAuth, createSession } from "../api/client.js";
import { sessions } from "../db/collections.js";
import { config, type BankConfig } from "../config.js";
import { EB_SESSION_VALIDITY_MS } from "../constants.js";
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

    if (session.accounts.length === 0) throw new Error("No accounts returned from session");

    for (const acc of session.accounts) {
      console.log(`  Account: ${acc.iban} (uid: ${acc.uid})`);
    }
    console.log(`Session created with ${session.accounts.length} account(s).`);

    const doc: Session = {
      _id: bankId,
      sessionId: session.session_id,
      accounts: session.accounts.map((a) => ({ uid: a.uid, iban: a.iban })),
      validUntil: new Date(Date.now() + EB_SESSION_VALIDITY_MS).toISOString(),
    };

    await sessions().replaceOne({ _id: bankId }, doc, { upsert: true });
    console.log(`Session for ${bank.name} stored in MongoDB.`);
  } finally {
    rl.close();
  }
}
