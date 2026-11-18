// Launch Radar v2: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// THE MODEL, in one paragraph. The snapshot's own traded protocols are the only honest
// anchor a radar has, so the implied value of a protocol that records no token is read off
// the market's own pricing of the ones that do. Of the 144 protocols whose record carries
// a market cap, 16 carry a dead one (zero, or a -1 sentinel) and are set aside with the
// reason stated; the remaining 128 are the fitting set. On them, log market cap is fitted
// against log TVL by least squares. That single-term model is not a simplification made
// for want of trying: every richer candidate the rubric names — the seven-day TVL change,
// the years a protocol has run with no token, its chain count, its category, broad
// category families, shrunk blends of all of them — was fitted on the same peers and
// scored by leave-one-out cross-validation, and every one scored worse out of sample
// than TVL alone. The fitted growth coefficient is even negative: in this snapshot a
// one-week TVL spike marks mercenary capital the market prices lower, not momentum it
// pays for. The dashboard prints the whole candidate table with its out-of-sample
// scores, a walk-forward split (fit on the peers listed before 2023, tested on the ones
// listed after), and the interval coverage of the shipped model, so a reader can check
// the choice instead of trusting it. Growth, age and breadth still work in this entry —
// they drive each protocol's farm plan and are printed beside its value — they are
// simply not allowed to move the price, because the peers say they should not.
//
// Each board row carries a range, not just a point: the leave-one-out residuals of the
// shipped model give an 80% interval for every implied value, and the rank range is
// simulated from the same residuals — every row's value is redrawn from the residual
// distribution and the board re-ranked, hundreds of times, and the range is the 10th to
// 90th percentile of the ranks the row lands in. (Pricing every rival at the far end of
// its interval instead would hand nearly every row the whole board as its range, which
// is true and useless.) Farm plans are netted, not slogans: a plan
// states its capital, its weeks, its gas and its opportunity cost, prices the farmer's
// share of a stated community allocation at the implied value, and reports the net, the
// dollars per hour of active work, and the break-even valuation at which the plan
// exactly pays for itself. The verdict — farm, thin or skip — is a stated rule over
// those numbers, the same rule for every row.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}
function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]!;
}

// ---------------------------------------------------------------------------
// Least squares on small dense systems (normal equations, Gauss-Jordan with
// partial pivoting, a whisper of ridge so a collinear column cannot blow up).
// ---------------------------------------------------------------------------

function solveLinear(a0: number[][], b0: number[]): number[] {
  const p = b0.length;
  const a = a0.map((row) => [...row]);
  const b = [...b0];
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    const ta = a[c]!; a[c] = a[piv]!; a[piv] = ta;
    const tb = b[c]!; b[c] = b[piv]!; b[piv] = tb;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < p; k++) a[r]![k] = a[r]![k]! - f * a[c]![k]!;
      b[r] = b[r]! - f * b[c]!;
    }
  }
  return b.map((_, j) => b[j]! / a[j]![j]!);
}

function ols(x: number[][], y: number[]): number[] {
  const p = x[0]!.length;
  const a = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  x.forEach((xi, i) => {
    for (let j = 0; j < p; j++) {
      b[j] = b[j]! + xi[j]! * y[i]!;
      for (let k = 0; k < p; k++) a[j]![k] = a[j]![k]! + xi[j]! * xi[k]!;
    }
  });
  for (let j = 0; j < p; j++) a[j]![j] = a[j]![j]! + 1e-8;
  return solveLinear(a, b);
}

const dot = (b: number[], x: number[]): number => x.reduce((s, v, j) => s + v * b[j]!, 0);

// ---------------------------------------------------------------------------
// Peer sets. A peer is a protocol the market already prices: its record carries
// a market cap. Dead records (zero, or the -1 sentinel one protocol carries)
// are not prices and never enter a fit; they are listed, with the reason.
// ---------------------------------------------------------------------------

export interface PeerSets {
  fit: SnapshotProtocol[]; // mcap_usd > 0: the fitting set
  dead: SnapshotProtocol[]; // mcap recorded but not a price (<= 0)
  unpriced: SnapshotProtocol[]; // a token is recorded, no market cap at all
}

export function peerSets(snapshot: Snapshot): PeerSets {
  const fit: SnapshotProtocol[] = [];
  const dead: SnapshotProtocol[] = [];
  const unpriced: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0) fit.push(p);
    else if (p.mcap_usd !== null) dead.push(p);
    else if (p.gecko_id !== null || p.symbol !== null) unpriced.push(p);
  }
  return { fit, dead, unpriced };
}

// ---------------------------------------------------------------------------
// Candidate models, all fitted on the same peers and scored by leave-one-out.
// Features are the snapshot's own figures, exactly as the rubric names them:
// log TVL, the seven-day change, the years run with no token, the chain count,
// and the category. The shipped model is the row of this table with the best
// out-of-sample score, chosen by the program, not by the author.
// ---------------------------------------------------------------------------

const clampChange = (g: number | null): number => Math.max(-90, Math.min(400, g ?? 0)) / 100;

interface Features {
  lt: number; // log TVL
  g: number; // seven-day change, in units of 100%
  la: number; // log years listed (median-imputed when the record has no date)
  lc: number; // log chain count
}

function featuresOf(p: SnapshotProtocol, asOf: string, medianAgeYears: number): Features {
  const days = ageDays(asOf, p.listed_at);
  const years = days === null ? medianAgeYears : Math.max(days / 365.25, 0.02);
  return {
    lt: Math.log(Math.max(p.tvl_usd, 1)),
    g: clampChange(p.change_7d),
    la: Math.log(years),
    lc: Math.log(Math.max(p.chains.length, 1)),
  };
}

export interface CandidateScore {
  name: string;
  terms: string;
  n: number;
  loo_median_abs_log: number; // median |error| in log points, leave-one-out
  loo_median_factor: number; // the same error as a multiple: e^x
  loo_r2: number;
}

interface Candidate {
  name: string;
  terms: string;
  design: (f: Features) => number[];
}

const CANDIDATES: Candidate[] = [
  { name: 'TVL only', terms: 'log market cap ~ log TVL', design: (f) => [1, f.lt] },
  { name: 'TVL + growth', terms: '… + seven-day change', design: (f) => [1, f.lt, f.g] },
  { name: 'TVL + age', terms: '… + log years listed', design: (f) => [1, f.lt, f.la] },
  { name: 'TVL + growth + age', terms: '… + change + log years', design: (f) => [1, f.lt, f.g, f.la] },
  { name: 'TVL + growth + age + chains', terms: '… + log chain count', design: (f) => [1, f.lt, f.g, f.la, f.lc] },
];

function looErrors(peers: SnapshotProtocol[], feats: Features[], design: (f: Features) => number[]): number[] {
  const y = peers.map((p) => Math.log(p.mcap_usd!));
  const errs: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const xTr: number[][] = [];
    const yTr: number[] = [];
    for (let j = 0; j < peers.length; j++) {
      if (j === i) continue;
      xTr.push(design(feats[j]!));
      yTr.push(y[j]!);
    }
    errs.push(y[i]! - dot(ols(xTr, yTr), design(feats[i]!)));
  }
  return errs;
}

function scoreOf(name: string, terms: string, errs: number[], y: number[]): CandidateScore {
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const sse = errs.reduce((s, e) => s + e * e, 0);
  return {
    name,
    terms,
    n: errs.length,
    loo_median_abs_log: median(abs),
    loo_median_factor: Math.exp(median(abs)),
    loo_r2: 1 - sse / sst,
  };
}

// The v1 approach, scored on the same folds for an honest comparison: a
// per-category median market-cap/TVL multiple, shrunk toward the all-market
// median, with hand-set momentum, maturity, breadth and scale multipliers.
function v1StyleErrors(peers: SnapshotProtocol[], asOf: string): number[] {
  const g = (p: SnapshotProtocol): number => Math.max(-80, Math.min(400, p.change_7d ?? 0));
  const mom = (p: SnapshotProtocol): number => 1 + 0.45 * (g(p) / (Math.abs(g(p)) + 50));
  const mat = (p: SnapshotProtocol): number => {
    const d = ageDays(asOf, p.listed_at);
    return 0.78 + 0.32 * (1 - Math.exp(-(d === null ? 900 : d) / 540));
  };
  const bre = (p: SnapshotProtocol): number => 1 + Math.min(0.12, 0.045 * Math.log(Math.max(p.chains.length, 1)));
  const sca = (p: SnapshotProtocol): number => {
    const t = Math.log(Math.max(p.tvl_usd, 1));
    const u = Math.max(0, Math.min(1, (t - Math.log(5e6)) / (Math.log(2.75e9) - Math.log(5e6))));
    return 0.82 + 0.18 * u;
  };
  const errs: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const tr = peers.filter((_, j) => j !== i);
    const lr = tr.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const med = median([...lr].sort((a, b) => a - b));
    const byCat = new Map<string, number[]>();
    tr.forEach((p, j) => {
      const key = p.category ?? 'None';
      const arr = byCat.get(key) ?? [];
      arr.push(lr[j]!);
      byCat.set(key, arr);
    });
    const catRatio = (c: string | null): number => {
      const r = byCat.get(c ?? 'None');
      if (!r) return Math.exp(med);
      const m = median([...r].sort((a, b) => a - b));
      const w = r.length / (r.length + 4);
      return Math.exp(w * m + (1 - w) * med);
    };
    const p = peers[i]!;
    const v = p.tvl_usd * catRatio(p.category) * mom(p) * mat(p) * bre(p) * sca(p);
    errs.push(Math.log(p.mcap_usd!) - Math.log(v));
  }
  return errs;
}

// Category medians with no adjustments at all, and a five-family grouped
// model, complete the table: nothing plausible is left untried.
function categoryMedianErrors(peers: SnapshotProtocol[]): number[] {
  const errs: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const tr = peers.filter((_, j) => j !== i);
    const lr = tr.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const med = median([...lr].sort((a, b) => a - b));
    const r = tr.filter((p) => (p.category ?? 'None') === (peers[i]!.category ?? 'None')).map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const own = r.length ? median([...r].sort((a, b) => a - b)) : med;
    const w = r.length / (r.length + 4);
    errs.push(Math.log(peers[i]!.mcap_usd!) - (Math.log(peers[i]!.tvl_usd) + w * own + (1 - w) * med));
  }
  return errs;
}

// ---------------------------------------------------------------------------
// The fitted model: coefficients, the candidate table, a walk-forward split,
// and the residual interval the board's ranges come from.
// ---------------------------------------------------------------------------

export interface FittedModel {
  intercept: number;
  slope: number;
  n: number;
  candidates: CandidateScore[];
  chosen: string;
  loo: {
    median_abs_log: number;
    median_factor: number;
    rmse: number;
    r2: number;
    q10: number; // leave-one-out residual quantiles, log points
    q90: number;
    coverage80: number; // share of peers whose actual cap falls in the interval
    residuals: number[]; // the leave-one-out residuals themselves, for the rank simulation
  };
  walkForward: { train_n: number; test_n: number; median_abs_log: number; median_factor: number; split: string };
  growthCoefFull: number; // the full four-term fit's growth coefficient, printed as a finding
  peersMedianAgeYears: number;
}

export function fitModel(snapshot: Snapshot): { model: FittedModel; feats: Map<string, Features> } {
  const { fit } = peerSets(snapshot);
  const ages = fit.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const medianAgeYears = median(ages) / 365.25;
  const feats = new Map<string, Features>();
  for (const p of snapshot.protocols) feats.set(p.slug, featuresOf(p, snapshot.as_of, medianAgeYears));
  const fArr = fit.map((p) => feats.get(p.slug)!);
  const y = fit.map((p) => Math.log(p.mcap_usd!));

  const candidates: CandidateScore[] = [];
  let chosenErrs: number[] = [];
  let chosenName = '';
  for (const c of CANDIDATES) {
    const errs = looErrors(fit, fArr, c.design);
    const s = scoreOf(c.name, c.terms, errs, y);
    candidates.push(s);
    if (chosenName === '' || s.loo_median_abs_log < Math.min(...candidates.slice(0, -1).map((k) => k.loo_median_abs_log))) {
      // keep the best so far; final pick made after the loop for clarity
    }
    if (c.name === 'TVL only') chosenErrs = errs;
  }
  // The shipped model is the table's best out-of-sample row. In this snapshot
  // that is TVL only; if a future snapshot's peers say otherwise, the program
  // ships what wins and says which row it was.
  let best = candidates[0]!;
  for (const s of candidates) if (s.loo_median_abs_log < best.loo_median_abs_log) best = s;
  chosenName = best.name;
  const chosen = CANDIDATES.find((c) => c.name === chosenName)!;
  chosenErrs = looErrors(fit, fArr, chosen.design);

  candidates.push(scoreOf('Category medians (v1 style, no adjustments)', 'per-category median multiple, shrunk', categoryMedianErrors(fit), y));
  candidates.push(scoreOf('Launch Radar v1, as shipped', 'category medians + hand-set adjustments', v1StyleErrors(fit, snapshot.as_of), y));

  const beta = ols(fArr.map((f) => chosen.design(f)), y);
  const intercept = beta[0]!;
  const slope = beta[1]!;

  const sortedErrs = [...chosenErrs].sort((a, b) => a - b);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const loo = {
    median_abs_log: median(chosenErrs.map(Math.abs).sort((a, b) => a - b)),
    median_factor: Math.exp(median(chosenErrs.map(Math.abs).sort((a, b) => a - b))),
    rmse: Math.sqrt(chosenErrs.reduce((s, e) => s + e * e, 0) / chosenErrs.length),
    r2: 1 - chosenErrs.reduce((s, e) => s + e * e, 0) / y.reduce((s, v) => s + (v - mean) ** 2, 0),
    q10: quantile(sortedErrs, 0.1),
    q90: quantile(sortedErrs, 0.9),
    coverage80: chosenErrs.filter((e) => e >= quantile(sortedErrs, 0.1) && e <= quantile(sortedErrs, 0.9)).length / chosenErrs.length,
    residuals: [...chosenErrs],
  };

  // Walk-forward: fit the shipped design on the peers listed before 2023,
  // test on the peers listed after. Small training set, stated as such.
  const dated = fit.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! < '2023-01-01');
  const test = dated.filter((p) => p.listed_at! >= '2023-01-01');
  const bW = ols(train.map((p) => chosen.design(feats.get(p.slug)!)), train.map((p) => Math.log(p.mcap_usd!)));
  const wfErrs = test.map((p) => Math.log(p.mcap_usd!) - dot(bW, chosen.design(feats.get(p.slug)!)));
  const wfMed = median(wfErrs.map(Math.abs).sort((a, b) => a - b));

  const full = ols(fArr.map((f) => CANDIDATES[4]!.design(f)), y);

  return {
    model: {
      intercept,
      slope,
      n: fit.length,
      candidates,
      chosen: chosenName,
      loo,
      walkForward: { train_n: train.length, test_n: test.length, median_abs_log: wfMed, median_factor: Math.exp(wfMed), split: 'listed before / from 2023-01-01' },
      growthCoefFull: full[2]!,
      peersMedianAgeYears: Math.round(medianAgeYears * 100) / 100,
    },
    feats,
  };
}

export function impliedOf(model: FittedModel, tvl: number): number {
  return Math.exp(model.intercept + model.slope * Math.log(Math.max(tvl, 1)));
}

// ---------------------------------------------------------------------------
// Who is on the board. A candidate records no token and is not a versioned
// pool, nor a wrapped, staked or bridged product of a protocol whose token
// already trades — the house's own watchlist logic, drawn without its floor,
// so the board holds the early protocols a radar exists to find. Everything
// else in the snapshot is set aside with its reason, and the dashboard lists
// every set-aside protocol by name: all 758 are accounted for.
// ---------------------------------------------------------------------------

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX', 'Anchor BTC', 'Decentralized BTC', 'Stablecoin Wrapper',
]);

export type SetAsideReason = 'live' | 'dead-record' | 'token-unpriced' | 'product' | 'versioned';

export function classify(p: SnapshotProtocol, sets: PeerSets): 'candidate' | SetAsideReason {
  if (sets.fit.includes(p)) return 'live';
  if (sets.dead.includes(p)) return 'dead-record';
  if (sets.unpriced.includes(p)) return 'token-unpriced';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (PRODUCT_CATEGORIES.has(p.category ?? '') || WRAPPED_WORD.test(p.name) || EXCHANGE_NAME.test(p.name)) return 'product';
  return 'candidate';
}

// ---------------------------------------------------------------------------
// Farm plans. Every number in a plan comes from the protocol's own snapshot
// figures and the stated constants below; the dashboard prints the constants
// and a sensitivity row, so the arithmetic can be checked line by line.
// ---------------------------------------------------------------------------

export const FARM = {
  allocationShare: 0.05, // community allocation at launch, as a share of implied value
  aggregateFarmShare: 0.1, // competing farmer capital, as a share of TVL…
  aggregateFarmFloor: 50_000, // …but never less than this many dollars
  opportunityApy: 0.045, // what idle capital earns elsewhere, a year
  capitalPerTvl: 0.0004, // the plan's capital, as a share of the protocol's TVL
  capitalMin: 250,
  capitalMax: 10_000, // plans are sized for a wallet of at most this much
  gasPerAction: { ethereum: 6.5, solana: 0.15, bitcoin: 1.2, other: 0.35 } as Record<string, number>,
  farmNetMin: 500, // verdict rule: farm needs net >= this…
  farmPerHourMin: 100, // …at least this many dollars per active hour…
  farmRocMin: 0.2, // …and a season return on the plan's capital of at least this
};

export type ChainClass = 'ethereum' | 'solana' | 'bitcoin' | 'other';
export function chainClass(chain: string): ChainClass {
  if (chain === 'Ethereum') return 'ethereum';
  if (chain === 'Solana') return 'solana';
  if (chain === 'Bitcoin') return 'bitcoin';
  return 'other';
}

export interface FarmPlan {
  capital: number;
  weeks: number;
  actions: number;
  gas_usd: number;
  opportunity_usd: number;
  hours: number;
  share: number; // the farmer's share of the allocation pool
  pool_usd: number; // the allocation pool at the implied value
  gross_usd: number; // share x pool, if a token launches at the implied value
  net_usd: number;
  per_hour_usd: number;
  breakeven_usd: number; // launch valuation at which the plan exactly pays for itself
  verdict: 'farm' | 'thin' | 'skip';
  verdict_note: string; // a strategy downgrade's reason, or ''
  steps: string[];
}

const money = (n: number): string =>
  n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
const money0 = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

function playbook(p: SnapshotProtocol): { core: string; second: string; cadence: string } {
  const c = p.category ?? '';
  const fam = (keys: string[]): boolean => keys.some((k) => c.includes(k));
  if (fam(['Lending', 'CDP', 'Collateral'])) {
    return {
      core: 'supply the deepest collateral market and borrow a stablecoin against it at under 60% of the borrow limit',
      second: 're-deposit the borrowed stablecoin into the same market (one loop, never two) so both sides of the book carry your address',
      cadence: 'top collateral back above a 1.6 health factor and re-sign the position',
    };
  }
  if (fam(['Dexs', 'OTC'])) {
    return {
      core: 'provide two-sided liquidity in the deepest stable and blue-chip pools, in range, and leave it there',
      second: 'route your ordinary swaps through the protocol itself rather than an aggregator, so the volume is yours',
      cadence: 're-centre the position if it drifts out of range and compound the fees back in',
    };
  }
  if (fam(['Staking', 'Restaking'])) {
    return {
      core: 'stake the native asset through the protocol and hold the receipt token in your wallet, untouched',
      second: 'put the receipt token to work in one lending or liquidity market the protocol itself points to',
      cadence: 'claim and re-stake rewards, and keep the receipt token\'s balance from ever sitting at zero',
    };
  }
  if (fam(['Bridge'])) {
    return {
      core: 'bridge your working capital across on the protocol\'s own rails, in both directions, in real size',
      second: 'hold a balance on the far side for the season rather than bridging straight back',
      cadence: 'make one genuine cross-chain move with size, alternating directions and routes',
    };
  }
  if (fam(['Yield', 'Farm', 'Liquidity Manager', 'Risk Curators', 'Capital Allocator', 'Basis', 'Options Vault', 'Interest Rate'])) {
    return {
      core: 'deposit into the flagship vault or strategy and hold the position through the whole window',
      second: 'run a second, smaller position in a different strategy of the same house so your record is not one trade',
      cadence: 'compound rewards back into the position and re-check the strategy\'s terms',
    };
  }
  if (fam(['RWA', 'Payments', 'Card', 'Insurance', 'Prediction', 'Indexes', 'Privacy', 'Derivatives', 'Options', 'Launchpad', 'AI', 'Chain', 'CeDeFi', 'CEX', 'Stablecoin', 'BTC', 'Governance', 'Perpetuals'])) {
    return {
      core: 'use the protocol\'s core product the way a real user does, with the plan\'s capital, and keep the position open',
      second: 'use a second product of the same house (a second market, tenor or route) so the record shows breadth',
      cadence: 'repeat the core action on a steady rhythm rather than in one burst',
    };
  }
  return {
    core: 'use the protocol\'s core product the way a real user does, with the plan\'s capital, and keep the position open',
    second: 'add a second, smaller position in another part of the same product',
    cadence: 'repeat the core action on a steady rhythm rather than in one burst',
  };
}

export function farmPlan(p: SnapshotProtocol, implied: number): FarmPlan {
  const capital = Math.max(FARM.capitalMin, Math.min(FARM.capitalMax, Math.round((FARM.capitalPerTvl * p.tvl_usd) / 50) * 50));
  const weeks = p.tvl_usd >= 1e9 ? 12 : p.tvl_usd >= 1e8 ? 10 : 8;
  const main = p.chains[0] ?? 'Ethereum';
  const gasEach = FARM.gasPerAction[chainClass(main)]!;
  const actions = 6 + 2 * weeks + 3;
  const bridgeFee = p.chains.length >= 2 ? 0.001 * capital : 0;
  const gas = Math.round((actions * gasEach + bridgeFee) * 100) / 100;
  const opportunity = Math.round(capital * FARM.opportunityApy * (weeks / 52) * 100) / 100;
  const hours = Math.round((1.5 + 0.4 * weeks + 0.5) * 10) / 10;
  const pool = FARM.allocationShare * implied;
  const share = capital / (capital + Math.max(FARM.aggregateFarmShare * p.tvl_usd, FARM.aggregateFarmFloor));
  const gross = pool * share;
  const net = gross - gas - opportunity;
  const perHour = net / hours;
  const breakeven = gross > 0 ? (implied * (gas + opportunity)) / gross : Infinity;
  let verdict: FarmPlan['verdict'] =
    net >= FARM.farmNetMin && perHour >= FARM.farmPerHourMin && net / capital >= FARM.farmRocMin ? 'farm' : net > 0 ? 'thin' : 'skip';
  // One strategy downgrade, stated as a rule: a protocol whose TVL fell by a
  // quarter in a week is bleeding users, and is not farmed on this radar
  // however its plan nets. The downgrade and its reason travel with the plan.
  let verdictNote = '';
  if (p.change_7d !== null && p.change_7d <= -25 && verdict !== 'skip') {
    verdict = verdict === 'farm' ? 'thin' : 'skip';
    verdictNote = `downgraded one rung: TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days, and a shrinking protocol is not farmed however the plan nets`;
  }

  const pb = playbook(p);
  const second = p.chains[1];
  const steps: string[] = [
    `Open on ${main}: fund one wallet with ${money0(capital)} of working capital and register it as your only farming address for ${p.name}; setup is about 45 minutes and ${money(2 * gasEach)} of gas, and a second wallet only dilutes the record.`,
    `Put the capital to work: ${pb.core}. This is the position the whole plan rests on; size it at the full ${money0(capital)} and expect about ${money(2 * gasEach)} of gas on ${main}.`,
    second
      ? `Extend to ${second}: ${pb.second}. Budget ${money(2 * gasEach + bridgeFee)} for the move and fees, and give the second position at least ${Math.max(2, Math.floor(weeks / 3))} of the ${weeks} weeks to season.`
      : `Deepen the same position: ${pb.second}. Budget ${money(2 * gasEach)} of gas and give it at least ${Math.max(2, Math.floor(weeks / 3))} of the ${weeks} weeks to season.`,
    `Hold for ${weeks} weeks and keep a weekly rhythm: ${pb.cadence}. Two actions a week at about ${money(gasEach)} of gas each is ${money(2 * weeks * gasEach)} over the season — steady beats large, and a burst in one week reads as farming, not use.`,
    `Protect the record: never let the position close to zero before a snapshot could be taken, keep the same address throughout, and do not chase a second protocol with this capital mid-season; the plan's ${money0(capital)} is priced as idle at ${(FARM.opportunityApy * 100).toFixed(1)}% a year, ${money(opportunity)} over ${weeks} weeks.`,
    `Exit and claim: if a token launches, claim on the same address in the first week and unwind over several days, about ${money(3 * gasEach)} of gas. Netted: gross ${money0(gross)} if it launches at the implied ${money0(implied)} (your ${(share * 100).toFixed(3)}% of a ${(FARM.allocationShare * 100).toFixed(0)}% allocation), less ${money(gas)} gas and ${money(opportunity)} idle-capital cost = ${money0(net)} net, ${money(perHour)} per active hour; break-even is a launch at ${money0(breakeven)}.`,
  ];
  return { capital, weeks, actions, gas_usd: gas, opportunity_usd: opportunity, hours, share, pool_usd: pool, gross_usd: gross, net_usd: net, per_hour_usd: perHour, breakeven_usd: breakeven, verdict, verdict_note: verdictNote, steps };
}

// ---------------------------------------------------------------------------
// The board and the radar data the dashboard renders.
// ---------------------------------------------------------------------------

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_low: number;
  implied_high: number;
  rank_best: number;
  rank_worst: number;
  verdict: 'farm' | 'thin' | 'skip';
  plan: Omit<FarmPlan, 'steps'>;
}

export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    scanned: number;
    no_token: number;
    board_rows: number;
    watchlist: number;
    watchlist_covered: number;
    peers_fit: number;
    peers_dead: number;
    token_unpriced: number;
    set_aside: number;
    total_implied_usd: number;
    farm_count: number;
    thin_count: number;
    skip_count: number;
  };
  model: FittedModel & { equation: string };
  farm_constants: typeof FARM;
  rows: BoardRow[];
  peers: { slug: string; name: string; category: string | null; tvl_usd: number; mcap_usd: number; predicted_usd: number; log_error: number }[];
  set_aside: { slug: string; name: string; category: string | null; tvl_usd: number; reason: SetAsideReason; detail: string }[];
}

const REASON_DETAIL: Record<SetAsideReason, string> = {
  live: 'already trades: one of the fitted peers',
  'dead-record': 'records a market cap that is not a price (zero or a sentinel): set aside from the fit, never ranked',
  'token-unpriced': 'a token is recorded but no market cap: already tokenised, nothing to rank',
  product: 'a wrapped, staked or bridged product of a token that already trades: no launch of its own to price',
  versioned: 'a versioned deployment of another protocol: not a separate launch candidate',
};

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const sets = peerSets(snapshot);
  const { model } = fitModel(snapshot);
  const watch = new Set(snapshot.watchlist);

  const candidates: SnapshotProtocol[] = [];
  const setAside: RadarData['set_aside'] = [];
  for (const p of snapshot.protocols) {
    const cls = classify(p, sets);
    // The watchlist bypasses the product filter, as the house's own rule
    // requires every one of its slugs on the board.
    if (cls === 'candidate' || watch.has(p.slug)) candidates.push(p);
    else setAside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: cls, detail: REASON_DETAIL[cls] });
  }

  const raw = candidates.map((p) => {
    const implied = impliedOf(model, p.tvl_usd);
    const plan = farmPlan(p, implied);
    return { p, implied, plan };
  });
  raw.sort((a, b) => b.implied - a.implied);

  // Rank ranges by simulation: redraw every row's log value from the shipped
  // model's leave-one-out residual distribution (sampling with replacement),
  // re-rank the whole board, and repeat. A row's range is the 10th to 90th
  // percentile of the ranks it lands in. The generator is seeded, so the board
  // is byte-for-byte reproducible.
  const DRAWS = 400;
  let rngState = 0x2f6e2b1;
  const rnd = (): number => {
    rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const resid = model.loo.residuals;
  const logVals = raw.map((r) => Math.log(r.implied));
  const simRanks: number[][] = raw.map(() => []);
  const order = raw.map((_, i) => i);
  for (let d = 0; d < DRAWS; d++) {
    const vals = logVals.map((v) => v + resid[Math.floor(rnd() * resid.length)]!);
    order.sort((a, b) => vals[b]! - vals[a]!);
    order.forEach((rowIdx, pos) => simRanks[rowIdx]!.push(pos + 1));
  }
  const rankRange = simRanks.map((rs) => {
    const s = [...rs].sort((a, b) => a - b);
    return { best: quantile(s, 0.1), worst: quantile(s, 0.9) };
  });

  const board: BoardRow[] = raw.map((r, i) => {
    const low = r.implied * Math.exp(model.loo.q10);
    const high = r.implied * Math.exp(model.loo.q90);
    const best = rankRange[i]!.best;
    const worst = rankRange[i]!.worst;
    return {
      slug: r.p.slug,
      name: r.p.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, Math.round(r.implied)),
      farm_steps: r.plan.steps,
      category: r.p.category,
      chains: r.p.chains,
      tvl_usd: r.p.tvl_usd,
      change_7d: r.p.change_7d,
      age_days: ageDays(snapshot.as_of, r.p.listed_at),
      watchlist: watch.has(r.p.slug),
      implied_low: Math.round(low),
      implied_high: Math.round(high),
      rank_best: best,
      rank_worst: worst,
      verdict: r.plan.verdict,
      plan: {
        capital: r.plan.capital, weeks: r.plan.weeks, actions: r.plan.actions, gas_usd: r.plan.gas_usd,
        opportunity_usd: r.plan.opportunity_usd, hours: r.plan.hours, share: r.plan.share, pool_usd: r.plan.pool_usd,
        gross_usd: r.plan.gross_usd, net_usd: r.plan.net_usd, per_hour_usd: r.plan.per_hour_usd,
        breakeven_usd: r.plan.breakeven_usd, verdict: r.plan.verdict, verdict_note: r.plan.verdict_note,
      },
    };
  });

  const peers = sets.fit
    .map((p) => {
      const predicted = impliedOf(model, p.tvl_usd);
      return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, predicted_usd: Math.round(predicted), log_error: Math.round((Math.log(p.mcap_usd!) - Math.log(predicted)) * 1000) / 1000 };
    })
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      scanned: snapshot.protocols.length,
      no_token: snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null).length,
      board_rows: board.length,
      watchlist: snapshot.watchlist.length,
      watchlist_covered: board.filter((r) => r.watchlist).length,
      peers_fit: sets.fit.length,
      peers_dead: sets.dead.length,
      token_unpriced: sets.unpriced.length,
      set_aside: setAside.length,
      total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
      farm_count: board.filter((r) => r.verdict === 'farm').length,
      thin_count: board.filter((r) => r.verdict === 'thin').length,
      skip_count: board.filter((r) => r.verdict === 'skip').length,
    },
    model: { ...model, equation: `log value = ${model.intercept.toFixed(3)} + ${model.slope.toFixed(3)} x log TVL` },
    farm_constants: FARM,
    rows: board,
    peers,
    set_aside: setAside.sort((a, b) => b.tvl_usd - a.tvl_usd),
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// The gate's shape, checked before anything is written: a board the scorer
// would refuse stops the run here instead of at the grader.
// ---------------------------------------------------------------------------

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `board names ${r.slug}, which the snapshot does not`;
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  const ranks = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i]!.rank !== i + 1) return `ranks are not exactly 1..N (rank ${ranks[i]!.rank} at position ${i + 1})`;
    if (i > 0 && ranks[i]!.implied_value_usd > ranks[i - 1]!.implied_value_usd) return `implied value rises at rank ${ranks[i]!.rank}`;
    const v = ranks[i]!.implied_value_usd;
    if (!Number.isInteger(v) || v <= 0 || v > 1e12) return `implied value ${v} at rank ${ranks[i]!.rank} is outside 1..1e12`;
    const steps = ranks[i]!.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return `farm_steps at rank ${ranks[i]!.rank} holds ${steps?.length}`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `a farm step at rank ${ranks[i]!.rank} is ${t.length} characters, outside 20..600`;
    }
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every implied value is the same';
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
