import { connect, disconnect } from "./db/mongo.js";
import { ensureIndexes } from "./db/collections.js";
import { runAuthFlow } from "./services/auth.js";
import { fetchAndStore } from "./services/fetcher.js";
import { getDailySummary, getMonthlySummary } from "./services/summarizer.js";
import { sendDailySummary, sendMonthlySummary } from "./services/telegram.js";

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === "auth") {
    const bankId = process.argv[3];
    if (!bankId) {
      console.error("Usage: node dist/index.js auth <bankId>");
      process.exit(1);
    }

    await connect();
    await ensureIndexes();
    try {
      await runAuthFlow(bankId);
    } finally {
      await disconnect();
    }
    return;
  }

  if (mode === "fetch") {
    const isMonday = new Date().getUTCDay() === 1;
    const fullLookback = process.argv.includes("--full") || isMonday;

    await connect();
    await ensureIndexes();
    try {
      await fetchAndStore(fullLookback);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const daily = await getDailySummary(today);
      if (daily) {
        await sendDailySummary(daily);
        console.log("Daily summary sent to Telegram.");
      }

      if (today.getUTCDate() === 1) {
        const lastMonth = new Date(today);
        lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
        const monthly = await getMonthlySummary(lastMonth.getFullYear(), lastMonth.getMonth() + 1);
        if (monthly) {
          await sendMonthlySummary(monthly);
          console.log("Monthly summary sent to Telegram.");
        }
      }
    } finally {
      await disconnect();
    }
    return;
  }

  console.error("Usage: node dist/index.js <auth <bankId> | fetch [--full]>");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
