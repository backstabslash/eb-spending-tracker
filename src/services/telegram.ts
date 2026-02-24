import { Telegraf } from "telegraf";
import { config } from "../config.js";
import type { DailySummary, MonthlySummary } from "./summarizer.js";

const bot = new Telegraf(config.telegramBotToken);

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatDaily(s: DailySummary): string {
  const dateStr = s.date.toISOString().split("T")[0];
  const [y, m, d] = dateStr.split("-");

  let msg = `<b>🗓 Daily Summary — ${d}.${m}.${y}\n\n💸 Spent: ${formatAmount(s.totalSpent, s.currency)}</b>\n`;

  if (s.transactions.length > 0) {
    msg += "\n";
    for (const tx of s.transactions) {
      msg += `• ${tx.counterpartyName}: -${formatAmount(tx.amount, tx.currency)}\n`;
    }
  }

  if (config.grafanaUrl) {
    msg += `\n📊 <a href="${config.grafanaUrl}&from=now-1d&to=now">Dashboard</a>`;
  }

  return msg;
}

function formatMonthly(s: MonthlySummary): string {
  const [yearStr, monthStr] = s.month.split("-");
  const monthStart = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  const monthEnd = new Date(Date.UTC(Number(yearStr), Number(monthStr), 1));

  let msg = `<b>🗓 Monthly Summary — ${monthStr}.${yearStr}\n\n`;
  msg += `💸 Spent: ${formatAmount(s.totalSpent, s.currency)}\n`;
  msg += `💰 Received: ${formatAmount(s.totalReceived, s.currency)}</b>\n`;

  if (s.topCounterparties.length > 0) {
    msg += `\n🏪 Top spending:\n`;
    for (const cp of s.topCounterparties) {
      msg += `• ${cp.name}: -${formatAmount(cp.total, s.currency)}\n`;
    }
  }

  if (config.grafanaUrl) {
    msg += `\n📊 <a href="${config.grafanaUrl}&from=${monthStart.getTime()}&to=${monthEnd.getTime()}">Dashboard</a>`;
  }

  return msg;
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
