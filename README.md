# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Saw4hlor/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Saw4hlor/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Launch Radar** — a token launch radar for the make.fun "Build the best token launch radar" bounty. It reads the sealed DefiLlama snapshot (758 protocols) and ranks every pre-token protocol by implied launch value: each category's valuation multiple is the median market-cap/TVL of that category's own live-token peers in the same snapshot, shrunk toward the global median, then adjusted for momentum, maturity, chain breadth and TVL scale. The board covers all 40 watchlist protocols plus 153 early sub-floor candidates, each with a value range, a factor-by-factor derivation, and a six-step farm plan with per-chain cost estimates. The static dashboard (board, per-protocol detail drawer, category/tier filters, five sort orders, and an "already trading" comps view) is generated from the same board data the program writes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22 or later, standard library only. The program writes `board.json`, `data.js`, the dashboard and `dossier.json` into the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kbwk68n8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
