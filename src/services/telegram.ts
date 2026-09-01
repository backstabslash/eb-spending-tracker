import { Telegraf } from "telegraf";
import { config } from "../config.js";
import { MS_PER_DAY } from "../constants.js";
import type { SessionAlert } from "./fetcher.js";
import type { CurrencyTotal, DailySummary, MonthlySummary } from "./summarizer.js";

const bot = new Telegraf(config.telegramBotToken);

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatTotals(totals: CurrencyTotal[], pick: (t: CurrencyTotal) => number): string {
  const parts = totals.filter((t) => pick(t) !== 0).map((t) => formatAmount(pick(t), t.currency));
  return parts.length > 0 ? parts.join(" + ") : formatAmount(0, totals[0]?.currency ?? "EUR");
}

function formatDaily(s: DailySummary): string {
  const dateStr = s.date.toISOString().split("T")[0];
  const [y, m, d] = dateStr.split("-");

  let msg = `<b>🗓 Daily Summary — ${d}.${m}.${y}\n\n💸 Spent: ${formatTotals(s.totals, (t) => t.spent)}</b>\n`;

  if (s.transactions.length > 0) {
    msg += "\n";
    for (const tx of s.transactions) {
      msg += `• ${tx.counterpartyName}: -${formatAmount(tx.amount, tx.currency)}\n`;
    }
  }

  if (config.grafanaUrl) {
    const dayStart = s.date.getTime();
    msg += `\n📊 <a href="${config.grafanaUrl}&from=${dayStart}&to=${dayStart + MS_PER_DAY}">Dashboard</a>`;
  }

  return msg;
}

function formatMonthly(s: MonthlySummary): string {
  const [yearStr, monthStr] = s.month.split("-");
  const monthStart = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const monthEnd = new Date(Date.UTC(Number(yearStr), Number(monthStr), 1));

  let msg = `<b>🗓 Monthly Summary — ${monthStr}.${yearStr}\n\n`;
  msg += `💸 Spent: ${formatTotals(s.totals, (t) => t.spent)}\n`;
  msg += `💰 Received: ${formatTotals(s.totals, (t) => t.received)}</b>\n`;

  if (s.topCounterparties.length > 0) {
    msg += `\n🏪 Top spending:\n`;
    for (const cp of s.topCounterparties) {
      msg += `• ${cp.name}: -${formatAmount(cp.total, cp.currency)}\n`;
    }
  }

  if (config.grafanaUrl) {
    msg += `\n📊 <a href="${config.grafanaUrl}&from=${monthStart.getTime()}&to=${monthEnd.getTime()}">Dashboard</a>`;
  }

  return msg;
}

function formatSessionAlert(alerts: SessionAlert[]): string {
  const expired = alerts.filter((a) => a.status !== "expiring");
  const expiring = alerts.filter((a) => a.status === "expiring");
  const parts: string[] = [];

  if (expired.length > 0) {
    let block = "<b>🔴 Auth expired</b>\n\n";
    for (const a of expired) {
      block += `• ${a.bankName} — no transactions are being fetched\n<code>auth ${a.bankId}</code>\n`;
    }
    parts.push(block);
  }

  if (expiring.length > 0) {
    let block = "<b>⚠️ Auth expiring</b>\n\n";
    for (const a of expiring) {
      const days = `${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"}`;
      block += `• ${a.bankName} — ${days} left\n<code>auth ${a.bankId}</code>\n`;
    }
    parts.push(block);
  }

  return parts.join("\n");
}

export async function sendSessionAlert(alerts: SessionAlert[]): Promise<void> {
  if (alerts.length === 0) {
    return;
  }

  await bot.telegram.sendMessage(config.telegramChatId, formatSessionAlert(alerts), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function sendDailySummary(summary: DailySummary): Promise<void> {
  await bot.telegram.sendMessage(config.telegramChatId, formatDaily(summary), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function sendMonthlySummary(summary: MonthlySummary): Promise<void> {
  await bot.telegram.sendMessage(config.telegramChatId, formatMonthly(summary), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
