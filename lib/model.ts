// Launch Radar's model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The board covers every slug on the snapshot's watchlist (the floor, never a ceiling) and adds every
// other genuine pre-token protocol the snapshot carries, at any size: the early rows are the point of
// a radar. A protocol counts as a genuine candidate when its record shows no token, it is not a
// versioned pool of another protocol, and it is not a product whose TVL is another asset in transit
// or in wrapped, staked or bridged form (the same product logic the house's watchlist rule states,
// drawn with the snapshot's category field, and without the watchlist's floor).
//
// Implied value is anchored to the market, not to a constant. The snapshot's own live-token protocols
// are the comparable set: for each category, the market's median market-cap-to-TVL ratio is read off
// the snapshot itself, shrunk toward the all-market median when a category has few traded peers, and
// applied to a pre-token protocol's TVL. Four documented adjustments then move that anchor:
//
//   momentum   1 + 0.45 * g / (|g| + 50), g = the 7-day TVL change clamped to [-80, 400]
//              (a saturating curve: growth is rewarded, a one-week spike cannot dominate)
//   maturity   0.78 + 0.32 * (1 - exp(-age_days / 540)); a protocol tracked longer with no token
//              carries more evidence. An unknown listing date scores at the pre-token median age.
//   breadth    1 + min(0.12, 0.045 * ln(chains)): distribution across chains, capped at +12%.
//   scale      0.82 at the snapshot's $5M floor rising in log space to 1.00 at $2.75B of TVL:
//              the smallest protocols' tokens historically clear at a discount to peer multiples.
//
//   implied    = round(TVL * category_multiple * momentum * maturity * breadth * scale)
//
// The same derivation yields a range: the category's shrunk 25th and 75th percentile ratios in place
// of its median. One uniform function scores every row; no protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it wherever it states a value. */
export const MODEL_VERSION = 'comps-2';

/** The model's constants, stated in the dashboard's method panel so a reader can re-derive any row. */
export const MODEL = {
  /** A category's own median is trusted in proportion n / (n + shrink_k) against the global median. */
  shrink_k: 6,
  /** Ratios are blended in log space; this floor keeps a near-zero peer median usable. */
  ratio_floor: 0.005,
  momentum_gain: 0.45,
  momentum_half: 50,
  momentum_min: -80,
  momentum_max: 400,
  maturity_base: 0.78,
  maturity_gain: 0.32,
  maturity_tau_days: 540,
  breadth_per_log_chain: 0.045,
  breadth_cap: 0.12,
  scale_floor: 0.82,
  scale_low_tvl: 5_000_000,
  scale_high_tvl: 2_750_000_000,
};

/** One category's comparable set, read off the snapshot's live-token protocols. */
export interface CompStat {
  category: string;
  peers: number;
  /** The shrunk median market-cap-to-TVL ratio a pre-token protocol of this category is valued at. */
  multiple: number;
  /** The shrunk 25th and 75th percentile ratios: the implied range's ends. */
  low: number;
  high: number;
}

/** The whole comparable table: the global anchor and one row per category that has traded peers. */
export interface CompTable {
  peers: number;
  median: number;
  low: number;
  high: number;
  by_category: Map<string, CompStat>;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the derivation the dashboard shows. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  multiple: number;
  comp_peers: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  factors: { momentum: number; maturity: number; breadth: number; scale: number };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board row itself, farm plan included. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the page shows the market's own value for it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, the comp table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  scanned: number;
  pre_token: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  comps: { peers: number; median: number; low: number; high: number; categories: CompStat[] };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A percentile of a sorted array, by linear interpolation between the two nearest ranks. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Blend two ratios in log space with weight `w` on the first: ratios are multiplicative things. */
function blendRatio(own: number, global: number, w: number): number {
  const a = Math.log(Math.max(own, MODEL.ratio_floor));
  const b = Math.log(Math.max(global, MODEL.ratio_floor));
  return Math.exp(w * a + (1 - w) * b);
}

/**
 * The comparable table: every live-token protocol with a market cap and TVL (exchanges set aside:
 * an exchange token's value is not a claim on its protocol TVL the way a DeFi token's is) gives one
 * market-cap-to-TVL ratio. Categories keep their own median, shrunk toward the global median by
 * n / (n + shrink_k), so a category with one traded peer borrows the market's anchor and a category
 * with fifteen stands mostly on its own record.
 */
export function compTable(snapshot: Snapshot): CompTable {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const r = p.mcap_usd / p.tvl_usd;
    ratios.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [r]);
    else list.push(r);
  }
  ratios.sort((a, b) => a - b);
  const global = {
    peers: ratios.length,
    median: percentile(ratios, 0.5),
    low: percentile(ratios, 0.25),
    high: percentile(ratios, 0.75),
  };
  const by_category = new Map<string, CompStat>();
  for (const [category, list] of perCategory) {
    const sorted = [...list].sort((a, b) => a - b);
    const w = list.length / (list.length + MODEL.shrink_k);
    by_category.set(category, {
      category,
      peers: list.length,
      multiple: blendRatio(percentile(sorted, 0.5), global.median, w),
      low: blendRatio(percentile(sorted, 0.25), global.low, w),
      high: blendRatio(percentile(sorted, 0.75), global.high, w),
    });
  }
  return { ...global, by_category };
}

/** The median known age of the snapshot's pre-token protocols: the score an unknown listing date gets. */
function medianPreTokenAge(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  ages.sort((a, b) => a - b);
  return ages.length === 0 ? 365 : Math.round(percentile(ages, 0.5));
}

/** Whether a protocol's record shows no token: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped or staked product names itself: a whole word, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Products that begin with an exchange's name are that exchange's, and its token already trades. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Categories whose TVL is another asset in transit or in another form: a bridge's TVL is the assets
 * it custodies for other protocols, a staking or restaking product's TVL is the underlying coin in
 * wrapped form, a BTC or stablecoin wrapper's TVL is the wrapped coin itself. In each case the value
 * already belongs to a token that trades, so the record is not a launch still to come. This is the
 * line the house's watchlist rule draws with the same categories; the snapshot carries no parent
 * field, so the category is the field that carries the distinction.
 */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
  'Stablecoin Wrapper',
  'CEX',
]);

/**
 * Whether a protocol is a genuine launch candidate: pre-token, in a category that launches tokens
 * of its own, not a versioned pool, and not a wrapped or staked product of a protocol whose token
 * already trades. The watchlist bypasses this filter (the gate requires every watchlist slug);
 * every other row must pass it.
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/** The four adjustments and the implied value one protocol gets, with its range. */
export interface Valuation {
  multiple: number;
  comp_peers: number;
  implied: number;
  low: number;
  high: number;
  momentum: number;
  maturity: number;
  breadth: number;
  scale: number;
  age: number | null;
}

/** Score one protocol against the comp table. The same function scores every row of the board. */
export function valueOf(p: SnapshotProtocol, snapshot: Snapshot, comps: CompTable, medianAge: number): Valuation {
  const stat = comps.by_category.get(p.category ?? 'Uncategorised');
  const multiple = stat?.multiple ?? comps.median;
  const lowRatio = stat?.low ?? comps.low;
  const highRatio = stat?.high ?? comps.high;
  const age = ageDays(snapshot.as_of, p.listed_at);

  const g = Math.min(MODEL.momentum_max, Math.max(MODEL.momentum_min, p.change_7d ?? 0));
  const momentum = 1 + MODEL.momentum_gain * (g / (Math.abs(g) + MODEL.momentum_half));
  const maturity =
    MODEL.maturity_base + MODEL.maturity_gain * (1 - Math.exp(-(age ?? medianAge) / MODEL.maturity_tau_days));
  const breadth = 1 + Math.min(MODEL.breadth_cap, MODEL.breadth_per_log_chain * Math.log(Math.max(1, p.chains.length)));
  const logT = Math.log10(Math.max(p.tvl_usd, 1));
  const scaleSpan = Math.log10(MODEL.scale_high_tvl) - Math.log10(MODEL.scale_low_tvl);
  const scalePart = Math.min(1, Math.max(0, (logT - Math.log10(MODEL.scale_low_tvl)) / scaleSpan));
  const scale = MODEL.scale_floor + (1 - MODEL.scale_floor) * scalePart;

  const adjust = momentum * maturity * breadth * scale;
  return {
    multiple,
    comp_peers: stat?.peers ?? 0,
    implied: Math.max(1, Math.round(p.tvl_usd * multiple * adjust)),
    low: Math.max(1, Math.round(p.tvl_usd * lowRatio * adjust)),
    high: Math.max(1, Math.round(p.tvl_usd * highRatio * adjust)),
    momentum,
    maturity,
    breadth,
    scale,
    age,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n and every watchlist slug present. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const comps = compTable(snapshot);
  const medianAge = medianPreTokenAge(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isCandidate(p));
  const scored = chosen.map((p) => ({ p, v: valueOf(p, snapshot, comps, medianAge) }));
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    multiple: round4(s.v.multiple),
    comp_peers: s.v.comp_peers,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    factors: {
      momentum: round4(s.v.momentum),
      maturity: round4(s.v.maturity),
      breadth: round4(s.v.breadth),
      scale: round4(s.v.scale),
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check it weekly.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How network fees run on a chain: Ethereum mainnet is dear, Solana is near-free, the rest are L2-cheap. */
function chainClass(chain: string): 'ethereum' | 'solana' | 'bitcoin' | 'layer2' {
  if (chain === 'Ethereum') return 'ethereum';
  if (chain === 'Solana') return 'solana';
  if (chain === 'Bitcoin') return 'bitcoin';
  return 'layer2';
}

const GAS: Record<string, { action: string; weekly: string }> = {
  ethereum: { action: 'about $9 of ETH in gas', weekly: 'about $6 of ETH in gas a week' },
  solana: { action: 'under $0.10 of SOL in fees', weekly: 'under $0.25 of SOL in fees a week' },
  bitcoin: { action: 'about $2 of BTC in fees', weekly: 'about $2 of BTC in fees a week' },
  layer2: { action: 'under $1 of gas', weekly: 'about $1 of gas a week' },
};

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 15_000_000) return 100;
  return 75;
}

/** How long to hold, from the protocol's age: a younger protocol needs a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's playbook: the core position, the second action that deepens it, the weekly cadence. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string; cadence: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      core: `Supply $${capital} of USDC as collateral in ${n} on ${chain}; supplied collateral is the balance a launch snapshot almost always reads first.`,
      second: `Borrow about 30% of the collateral's value in a second asset and repay it a week later, so the account shows both sides of the market.`,
      cadence: `Add or withdraw a small amount (about $10) so the position is touched every week, not parked and forgotten.`,
    };
  if (c.includes('dex') || c.includes('liquidity'))
    return {
      core: `Provide $${capital} split evenly across both assets of ${n}'s busiest pool on ${chain} and keep the LP position open.`,
      second: `Route one swap of about $25 through ${n} itself each time you visit, so the wallet carries trader history as well as liquidity.`,
      cadence: `Swap about $25 through the exchange and re-check the LP range weekly; withdraw and re-add once if the position drifts out of range.`,
    };
  if (c.includes('bridge'))
    return {
      core: `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then hold or use the bridged funds on the far side instead of bridging straight back.`,
      second: `Make a second, smaller bridge (about $40) on a different day and in the other direction, so the wallet is a user of the route, not a single pass.`,
      cadence: `Bridge about $25 once a week, varying the route and the day, and keep a balance on the destination chain between trips.`,
    };
  if (c.includes('restak') || c.includes('staking'))
    return {
      core: `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token in the same wallet.`,
      second: `Put the receipt token to work in one partner market ${n} lists (a lending market or a pool), so the position earns a second layer of activity.`,
      cadence: `Claim and re-stake any rewards weekly, and add a small top-up (about $15) once a month while the position runs.`,
    };
  if (c.includes('derivative') || c.includes('perpetual'))
    return {
      core: `Deposit $${capital} of USDC as margin on ${n} and open one small position (about $50 of size) hedged against a spot holding, so the account trades without directional risk.`,
      second: `Place and cancel a few limit orders around the market price, so the account shows order-book activity, not only market orders.`,
      cadence: `Trade about $100 of volume a week in two or three small orders, and keep the margin account funded between sessions.`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral markets'))
    return {
      core: `Deposit $${capital} into one of ${n}'s curated vaults on ${chain}; pick the vault with the longest running history rather than the highest headline yield.`,
      second: `Hold the vault shares untouched for the first month: curator launches read holder duration and share balance, and churn reads as farming.`,
      cadence: `Review the vault's allocation weekly and add about $20 a month, so the balance grows the way a real allocator's would.`,
    };
  if (c.includes('rwa'))
    return {
      core: `Complete ${n}'s onboarding or KYC if it asks for one, then mint or buy $${capital} of its yield-bearing asset on ${chain} and hold it.`,
      second: `Hold the asset across at least one full yield distribution, so the wallet is on the holder record when distributions are tallied.`,
      cadence: `Check the position weekly and add about $25 after each distribution, compounding into the same asset.`,
    };
  if (c.includes('basis') || c.includes('cedefi') || c.includes('yield'))
    return {
      core: `Deposit $${capital} of USDC into ${n}'s main vault or strategy on ${chain} and keep the shares in the depositing wallet.`,
      second: `Leave the shares untouched through one full rewards epoch before moving anything: epochs are the unit a distribution counts.`,
      cadence: `Claim rewards as they land and re-deposit them weekly; add about $20 a month so the position is visibly compounding.`,
    };
  if (c.includes('chain'))
    return {
      core: `Bridge $${capital} of USDC onto ${n}'s chain and make it the wallet's home chain for a month: hold the balance there instead of passing through.`,
      second: `Use two or three of the chain's native apps (a swap, a lend, a stake) so the wallet's history is spread across the ecosystem a launch would reward.`,
      cadence: `Make two or three small transactions a week on the chain, on different days, the way a resident user would.`,
    };
  if (c.includes('payment'))
    return {
      core: `Fund the wallet with $${capital} and route real transfers through ${n}: pay a second wallet you control and move funds back on a later day.`,
      second: `Keep a standing balance in ${n} between transfers; balances held over time are the cheapest signal of a genuine user.`,
      cadence: `Make one or two transfers a week of varying amounts, and keep the account active on at least eight separate days a month.`,
    };
  if (c.includes('insurance'))
    return {
      core: `Buy about $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to its full term.`,
      second: `Stake a smaller amount (about $40) into ${n}'s underwriting pool if it offers one, so the wallet appears on both sides of the market.`,
      cadence: `Renew or extend the cover as it lapses and check the policy monthly; an unbroken cover history is the record that counts.`,
    };
  if (c.includes('prediction'))
    return {
      core: `Fund $${capital} and take positions in three or four of ${n}'s markets, sized small (about $15 each) and held to settlement.`,
      second: `Provide liquidity on one market's book if ${n} allows it, so the account is both a trader and a maker.`,
      cadence: `Trade on at least two days a week and let positions settle rather than closing everything early.`,
    };
  return {
    core: `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open; a held balance is the record every launch reads.`,
    second: `Use one more of ${n}'s own features in the same wallet (a second product, a governance vote, its points page), so the account reads as a user, not a deposit.`,
    cadence: `Make one qualifying action a week, such as a small deposit, a claim or a vote, so the wallet is active in most weekly snapshots.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) by one uniform playbook. No name is special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = GAS[chainClass(chain)]!;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbook(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet for this farm and fund it on ${chain} with the position's capital plus a little extra for fees; keep its seed phrase offline and never reuse a wallet that holds your main funds.`,
      cost: 'nothing to open; fund it with the capital below plus a fee buffer',
      time: '10 minutes',
    },
    { text: book.core, cost: `$${capital} of capital and ${gas.action}`, time: '15 minutes to set up' },
    { text: book.second, cost: `about $${Math.max(15, Math.round(capital / 5))} more of capital and ${gas.action}`, time: '10 minutes' },
    { text: book.cadence, cost: gas.weekly, time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days so it appears in several weekly snapshots, and check ${p.name}'s own points or rewards page from inside its app before withdrawing anything; claim only from a link the protocol itself publishes.`,
      cost: `the $${capital} stays in the position; never pay anyone to claim for you`,
      time: `${hold} days of holding, 10 minutes to check`,
    },
    {
      text: `Keep a farm log with the wallet, the dates and every transaction hash, and set a monthly reminder to re-check the position; if the protocol announces a token, the log is your proof of when you were active.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
  ];
}

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** The live-token protocols, by market cap: the market's own values, kept apart from the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Math.round((p.mcap_usd! / Math.max(1, p.tvl_usd)) * 1e4) / 1e4,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const comps = compTable(snapshot);
  const categories = [...comps.by_category.values()].sort(
    (a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    scanned: snapshot.protocols.length,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    comps: {
      peers: comps.peers,
      median: round4(comps.median),
      low: round4(comps.low),
      high: round4(comps.high),
      categories: categories.map((c) => ({ ...c, multiple: round4(c.multiple), low: round4(c.low), high: round4(c.high) })),
    },
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
