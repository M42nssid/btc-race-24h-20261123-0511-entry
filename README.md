[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/M42nssid/btc-race-24h-20261123-0511-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/M42nssid/btc-race-24h-20261123-0511-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

# Step Rider — a cbBTC/USDC trading bot for make.fun

An entry for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261123-0511)
(`btc-race-24h-20261123-0511`): a bot that trades Coinbase Wrapped BTC
(cbBTC) against USDC, minute by minute, in a replay of on-chain prices,
starting with 1,000 USDC of paper money, long only.

## Strategy

One-minute BTC noise is large next to any real move (the dev window's
1-minute returns have a standard deviation of about 8 bps, while a full-size
round trip costs about 26 bps in fees, slippage and price impact), so chasing
every wiggle bleeds. Step Rider therefore waits for a move big enough to
matter — the close 120 bars (2 hours) up at least 50 bps — buys the whole
cash balance once, and then sits through the chop behind a wide trailing stop,
200 bps below the highest close since entry. The stop is wide on purpose:
the dev window's post-step chop swings about 80 bps peak to trough, so a
tight stop would be shaken out and re-enter again and again, paying the
round-trip cost each time.

A second, deliberately narrow entry covers the opposite regime: after a sharp
2-hour fall (120-bar return at or below −150 bps) with RSI(14) under 30, the
bot buys the oversold dip, exiting on the same trailing stop. On the dev
window this entry never fires, so it costs nothing there; it exists so that a
falling race window still sees the bot trade at least once instead of sitting
in cash all day.

Exits use the trailing stop only. There is no fixed take-profit and no
momentum-reversal exit: backtests on the dev window showed a reversal exit
turning a +$31 trade into a breakeven one, because the 120-bar return dips
below zero repeatedly while the price merely drifts sideways after a step up.
No entry is taken in the last two hours of the window.

## Running it

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin and
stdout) and runs as `node main.ts` under Node 22 (type stripping, standard
library only). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's
SDK shim.

Grade it on the dev window with the kit's command line:

```
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot <this repo> --driver process
```

## Dev-window result

- Net PnL: **+$31.09 USDC** (1 buy, held to the end of the window)
- Max drawdown: 198 bps — well inside the 25% guardrail
- Deterministic: two runs produce byte-identical action logs

## License

MIT — see [LICENSE](LICENSE).
