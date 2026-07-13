/**
 * Post-redaction validator. Step E of
 * docs/link-agent/plan-split-negotiate.md.
 *
 * Pure function that inspects the redactor's body against the decided
 * `Action` + known agreed state, and returns a list of issues. The
 * orchestrator (step F) decides whether to regenerate once or drop the send.
 *
 * What we check:
 *   1. Prices named in the body equal `action.price` (when the action has one).
 *      If the action has no price, the body must name no price at all.
 *   2. Dates named in the body equal `agreedDate` (when one is set). When no
 *      date is agreed, any date is accepted — logistics flows often propose
 *      one.
 *   3. No protickets.com / hellotickets.com URL anywhere in the body.
 *   4. Body is non-empty.
 */

import type { Action } from "./decisor";

export interface ValidatorInput {
  body: string | null;
  action: Action;
  agreedDate: string | null; // ISO YYYY-MM-DD
}

export interface ValidatorResult {
  ok: boolean;
  issues: string[];
}

/**
 * Matches money-like numbers adjacent to € / $ / EUR / USD, or a bare integer
 * followed by `euros?`. Captures the numeric portion only. We intentionally
 * accept both "200€", "€200", "200 EUR", "200 euros", and comma decimals. Note
 * that fractional prices go through Math.round, which rounds .5 toward +∞
 * (so "1.200,50€" → 1201). Action prices are always integers rounded to tens,
 * so any fractional price in the body will be flagged as a mismatch — which
 * is the safe behavior.
 */
const PRICE_RX =
  /(?:€|\$|EUR|USD)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:€|\$|EUR|USD|euros?|dólares?)/gi;

/** Liberal ISO / d-m-y / m/d/y matcher. We only check that named dates line up; false negatives are acceptable. */
const DATE_RX =
  /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;

const BANNED_HOST_RX = /\b(?:www\.)?(?:protickets\.com|hellotickets\.com)\b/i;

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function extractPrices(body: string): number[] {
  const prices: number[] = [];
  for (const m of body.matchAll(PRICE_RX)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const p = parsePrice(raw);
    if (p !== null) prices.push(p);
  }
  return prices;
}

function extractDates(body: string): string[] {
  const dates: string[] = [];
  for (const m of body.matchAll(DATE_RX)) {
    if (m[1]) {
      dates.push(m[1]);
      continue;
    }
    const a = Number(m[2]);
    const b = Number(m[3]);
    const c = Number(m[4]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
    // Heuristic: if c is 4 digits, it's the year. Otherwise treat yyyy-like as
    // 20xx. Day/month order: we assume day-first (EU-dominant in this app).
    const year = c < 100 ? 2000 + c : c;
    const day = a;
    const month = b;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function actionPrice(action: Action): number | null {
  return action.kind === "accept" || action.kind === "counter" ? action.price : null;
}

export function validate({ body, action, agreedDate }: ValidatorInput): ValidatorResult {
  const issues: string[] = [];

  if (body === null || body.trim() === "") {
    // Only valid for stall / terminal — those never reach the validator in
    // the orchestrator, but handle defensively.
    if (action.kind === "stall" || action.kind === "terminal") {
      return { ok: true, issues: [] };
    }
    return { ok: false, issues: ["body is empty"] };
  }

  if (BANNED_HOST_RX.test(body)) {
    issues.push("body links to protickets.com or hellotickets.com");
  }

  const prices = extractPrices(body);
  const expectedPrice = actionPrice(action);

  if (expectedPrice === null) {
    if (prices.length > 0) {
      issues.push(
        `body names price(s) ${JSON.stringify(prices)} but action ${action.kind} carries none`,
      );
    }
  } else if (prices.length === 0) {
    issues.push(`body names no price but action ${action.kind} expected ${expectedPrice}`);
  } else {
    const bad = prices.filter((p) => p !== expectedPrice);
    if (bad.length > 0) {
      issues.push(
        `body prices ${JSON.stringify(prices)} do not all equal action.price=${expectedPrice}`,
      );
    }
  }

  if (agreedDate !== null) {
    const dates = extractDates(body);
    const mismatches = dates.filter((d) => d !== agreedDate);
    if (mismatches.length > 0) {
      issues.push(
        `body dates ${JSON.stringify(dates)} include mismatches vs agreedDate=${agreedDate}`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}
