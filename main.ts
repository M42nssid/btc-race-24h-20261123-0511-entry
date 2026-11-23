// Step Rider: a slow-momentum trend bot for the cbBTC/USDC 24-hour race.
//
// Idea, in one paragraph: one-minute BTC noise is large next to any real move
// (the dev window's 1-minute returns have a standard deviation of about 8 bps,
// while a full-size round trip costs about 26 bps in fees, slippage and price
// impact), so chasing every wiggle bleeds. This bot therefore waits for a move
// big enough to matter — the close 2% of an hour, 120 bars, up at least 50 bps
// — buys the whole cash balance once, and then sits through the chop behind a
// wide trailing stop, 200 bps below the highest close since entry. The stop is
// wide on purpose: the dev window's post-step chop swings about 80 bps peak to
// trough, so a tight stop would be shaken out and re-enter again and again,
// paying the round-trip cost each time. The bot re-enters only when the same
// 120-bar momentum signal fires again after an exit.
//
// A second, deliberately narrow entry covers the opposite regime: after a sharp
// 2-hour fall (120-bar return at or below -150 bps) with RSI(14) under 30, the
// bot buys the oversold dip, exiting on the same trailing stop. On the dev
// window this entry never fires, so it costs nothing there; it exists so that a
// falling race window still sees the bot trade at least once instead of sitting
// in cash all day.
//
// Exits: the trailing stop only. There is no fixed take-profit and no reversal
// exit: backtests on the dev window showed a momentum-reversal exit turning a
// +$31 trade into a breakeven one, because the 120-bar return dips below zero
// repeatedly while the price merely drifts sideways after a step up.
//
// Determinism: every decision is a pure function of the closes seen so far.
// No clock, no environment, no randomness, no network, no files. Indicators
// are computed in float64 from the recorded closes, and the momentum in bps is
// integer math (floor division, as in the kit's Python backtests), so two runs
// on the same bars send the same orders.
//
// Long only, at most one open position, at most one order per reply, full-size
// buys (all cash), whole-position sells. Each order caps slippage at 100 bps
// past the close it was decided on. No entry is taken in the last two hours of
// the window: a fill there would leave almost no bars for the move to pay for
// its own round-trip cost.

import { runBars, type BarsState, type Batch, type OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
/** Bars of momentum lookback (2 hours of 1-minute bars). */
const LOOKBACK = 120;
/** Entry: 120-bar return at or above this, in bps. */
const ENTRY_BPS = 50;
/** Dip entry: 120-bar return at or below this, in bps, with RSI under RSI_LO. */
const BOUNCE_BPS = -150;
/** RSI(14) must be under this for the dip entry. */
const RSI_LO = 30;
/** Wilder RSI period. */
const RSI_PERIOD = 14;
/** Trailing stop: this many bps below the highest close since entry. */
const TRAIL_BPS = 200;
/** Max slippage allowed on any order, in bps past the deciding close. */
const MAX_SLIPPAGE_BPS = 100;
/** No new entry once this many bars of the window have closed. */
const LAST_ENTRY_BAR = 1320;

/** Closes seen so far, oldest first; a missing bar adds nothing. */
const closes: number[] = [];
/** Highest close since the current entry; null while flat. */
let peak: number | null = null;
/** A buy was sent and its fill has not been seen yet. */
let pendingBuy = false;
/** A sell was sent and its fill has not been seen yet. */
let pendingSell = false;

/** Wilder's RSI(14) over the closes, or null before 14 changes exist. */
function rsi14(): number | null {
  const n = closes.length;
  if (n <= RSI_PERIOD) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= RSI_PERIOD;
  loss /= RSI_PERIOD;
  for (let i = RSI_PERIOD + 1; i < n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (RSI_PERIOD - 1) + g) / RSI_PERIOD;
    loss = (loss * (RSI_PERIOD - 1) + l) / RSI_PERIOD;
  }
  if (gain + loss === 0) return 50;
  return (100 * gain) / (gain + loss);
}

runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);
    const i = closes.length - 1;

    // Reconcile the pending flags with what this batch reports: a rejected
    // order frees its side to be tried again on the next bar.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.status === "rejected") {
        if (fill.side === "buy") pendingBuy = false;
        if (fill.side === "sell") pendingSell = false;
      }
    }

    const held = (state.positions.get(SYMBOL)?.qty ?? 0n) > 0n;
    if (held) {
      pendingBuy = false;
      peak = peak === null ? close : Math.max(peak, close);
    } else {
      pendingSell = false;
      peak = null;
    }

    if (i < LOOKBACK) return [];

    if (!held && !pendingBuy && i <= LAST_ENTRY_BAR) {
      // 120-bar return in bps, floored, exactly as the backtest computes it.
      const back = closes[i - LOOKBACK]!;
      const momBps = Math.floor(((close - back) * 10000) / back);
      const dip = momBps <= BOUNCE_BPS && (rsi14() ?? 100) < RSI_LO;
      if (momBps >= ENTRY_BPS || dip) {
        if (state.cash <= 0n) return [];
        pendingBuy = true;
        return [
          {
            side: "buy",
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    if (held && !pendingSell && peak !== null) {
      const stop = Math.floor((peak * (10000 - TRAIL_BPS)) / 10000);
      if (close <= stop) {
        const qty = state.positions.get(SYMBOL)?.qty ?? 0n;
        if (qty <= 0n) return [];
        pendingSell = true;
        return [
          {
            side: "sell",
            symbol: SYMBOL,
            qty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
    }

    return [];
  },
});
