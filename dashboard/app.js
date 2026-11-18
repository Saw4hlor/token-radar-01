// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts
// from the same snapshot and the same model) and renders four things: the ranked board,
// a detail view for every protocol on it, the method with its out-of-sample scores, and
// the full accounting of the snapshot — the fitted peers and every protocol set aside,
// with its reason. No network: every byte it shows is in data.js. View state lives in the
// location hash (#/ the board, #/?cat=..&verdict=.. a filtered board, #/p/<slug> a detail),
// so any view a reader lands on can be linked, screenshotted and checked against the code.
(function () {
  'use strict';
  var D = window.RADAR;
  var M = D.model, META = D.meta, FC = D.farm_constants;
  var app = document.getElementById('app');

  // ---------- formatting ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function usdShort(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return usd(n);
  }
  function pct(n, dp) { return (n * 100).toFixed(dp === undefined ? 1 : dp) + '%'; }
  function chg(n) {
    if (n === null || n === undefined) return '<span class="sub">no 7d reading</span>';
    return '<span class="' + (n >= 0 ? 'pos' : 'neg') + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageStr(days) {
    if (days === null || days === undefined) return 'unlisted date';
    if (days < 60) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + ' mo';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function badge(v) { return '<span class="badge ' + v + '">' + v + '</span>'; }

  // ---------- routing ----------
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {};
    var qi = h.indexOf('?');
    if (qi >= 0) { new URLSearchParams(h.slice(qi + 1)).forEach(function (v, k) { q[k] = v; }); h = h.slice(0, qi); }
    if (h.indexOf('p/') === 0) return { view: 'detail', slug: h.slice(2), q: q };
    return { view: 'board', q: q };
  }

  // ---------- header ----------
  function header() {
    return '<header class="top"><div class="wordmark">LAUNCH<b>RADAR</b></div>' +
      '<div class="tagline">Pre-token protocols ranked by an implied value fitted on the snapshot\'s own traded protocols — ' +
      'the model chosen by leave-one-out cross-validation, in the open — with a farm plan for every row, netted to the dollar.</div>' +
      '<div class="src">' + esc(META.source) + '<br>snapshot ' + esc(META.as_of) + ' · board built from these bytes alone</div></header>';
  }

  function kpis() {
    var tiles = [
      [META.scanned, 'protocols scanned'],
      [META.no_token, 'record no token'],
      [META.board_rows, 'ranked on the board'],
      [META.watchlist_covered + '/' + META.watchlist, 'watchlist covered'],
      [META.peers_fit, 'traded peers fitted'],
      ['<em>×' + M.loo.median_factor.toFixed(2) + '</em>', 'median error, leave-one-out'],
      ['<em>×' + M.walkForward.median_factor.toFixed(2) + '</em>', 'walk-forward error'],
      [usdShort(META.total_implied_usd), 'total implied value'],
    ];
    return '<div class="kpis">' + tiles.map(function (t) {
      return '<div class="kpi"><div class="v">' + t[0] + '</div><div class="k">' + t[1] + '</div></div>';
    }).join('') + '</div>' +
      '<p class="axes"><b>Rank is by implied value; the verdict prices your plan, not the protocol.</b> ' +
      'Plans are sized for a wallet of at most ' + usd(FC.capitalMax) + ': on the giants that is a rounding error in the allocation, ' +
      'so they read thin however large the prize. The season\'s farms sit lower down, where the same dollars buy a real share.</p>';
  }

  // ---------- board ----------
  var SORTS = {
    rank: ['Rank', function (r) { return r.rank; }],
    value: ['Implied value', function (r) { return r.implied_value_usd; }],
    tvl: ['TVL', function (r) { return r.tvl_usd; }],
    net: ['Plan net', function (r) { return r.plan.net_usd; }],
    ph: ['$/hour', function (r) { return r.plan.per_hour_usd; }],
    chg: ['7d change', function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }],
    age: ['Age', function (r) { return r.age_days === null ? -1 : r.age_days; }],
  };

  function boardView(q) {
    var cats = [], chains = [], seenC = {};
    D.rows.forEach(function (r) {
      if (r.category && !seenC[r.category]) { seenC[r.category] = 1; cats.push(r.category); }
    });
    var chainSet = {};
    D.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainSet[c] = 1; }); });
    chains = Object.keys(chainSet).sort();
    cats.sort();

    var sort = SORTS[q.sort] ? q.sort : 'rank';
    var rows = D.rows.filter(function (r) {
      if (q.q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q.q.toLowerCase()) < 0) return false;
      if (q.cat && r.category !== q.cat) return false;
      if (q.chain && (r.chains || []).indexOf(q.chain) < 0) return false;
      if (q.verdict && r.verdict !== q.verdict) return false;
      if (q.watch === '1' && !r.watchlist) return false;
      return true;
    });
    var key = SORTS[sort][1];
    rows = rows.slice().sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    if (sort === 'rank') rows.sort(function (a, b) { return a.rank - b.rank; });

    function opt(v, cur, label) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    var controls = '<div class="controls">' +
      '<input type="search" id="f-q" placeholder="Search name, slug, category" value="' + esc(q.q || '') + '">' +
      '<select id="f-cat">' + opt('', q.cat || '', 'All categories') + cats.map(function (c) { return opt(c, q.cat || '', c); }).join('') + '</select>' +
      '<select id="f-chain">' + opt('', q.chain || '', 'All chains') + chains.map(function (c) { return opt(c, q.chain || '', c); }).join('') + '</select>' +
      '<select id="f-verdict">' + opt('', q.verdict || '', 'All verdicts') + ['farm', 'thin', 'skip'].map(function (v) { return opt(v, q.verdict || '', v[0].toUpperCase() + v.slice(1)); }).join('') + '</select>' +
      '<label class="chk"><input type="checkbox" id="f-watch"' + (q.watch === '1' ? ' checked' : '') + '> Watchlist only</label>' +
      '<select id="f-sort">' + Object.keys(SORTS).map(function (k) { return opt(k, sort, 'Sort: ' + SORTS[k][0]); }).join('') + '</select>' +
      '<span class="count">' + rows.length + ' of ' + D.rows.length + ' rows</span></div>';

    var head = '<tr><th>#</th><th>Protocol</th><th>TVL</th><th>7d</th><th>Age</th><th>Implied value</th><th>Rank range</th><th>Your share</th><th>Plan net</th><th>$/hour</th><th>Verdict</th></tr>';
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td class="name"><span class="nm">' + esc(r.name) + '</span><span class="ct">' + esc(r.category || 'Uncategorised') + '</span>' +
        (r.watchlist ? '<span class="wbadge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + usdShort(r.tvl_usd) + '</td><td>' + chg(r.change_7d) + '</td><td>' + ageStr(r.age_days) + '</td>' +
        '<td>' + usd(r.implied_value_usd) + '<span class="sub">' + usdShort(r.implied_low) + ' – ' + usdShort(r.implied_high) + '</span></td>' +
        '<td>' + r.rank_best + ' – ' + r.rank_worst + '</td>' +
        '<td>' + pct(r.plan.share, 3) + '</td>' +
        '<td>' + usd(r.plan.net_usd) + '</td><td>' + usd(r.plan.per_hour_usd) + '</td>' +
        '<td>' + badge(r.verdict) + '</td></tr>';
    }).join('');
    return header() + kpis() + controls +
      '<table class="board" id="board"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      methodSection() + peersSection() + asideSection() + footer();
  }

  // ---------- detail ----------
  function nearestPeers(r) {
    var lt = Math.log(r.tvl_usd);
    return D.peers.slice().sort(function (a, b) {
      return Math.abs(Math.log(a.tvl_usd) - lt) - Math.abs(Math.log(b.tvl_usd) - lt);
    }).slice(0, 5);
  }

  function detailView(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return header() + '<p class="axes">No board row for ' + esc(slug) + '. <a href="#/">Back to the board</a></p>';
    var p = r.plan;
    var cells = [
      [usdShort(r.tvl_usd), 'TVL (snapshot)'],
      [r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%', 'TVL change, 7 days'],
      [ageStr(r.age_days), 'tracked with no token'],
      [(r.chains || []).join(', ') || '—', 'chains'],
      [usd(r.implied_value_usd), 'implied value'],
      [usdShort(r.implied_low) + ' – ' + usdShort(r.implied_high), '80% interval (model)'],
      ['#' + r.rank + ' (' + r.rank_best + '–' + r.rank_worst + ')', 'rank (range)'],
      [r.watchlist ? 'yes' : 'no', 'on the house watchlist'],
      [usd(p.capital), 'plan capital'],
      [p.weeks + ' wks · ' + p.hours + ' hrs active', 'plan window'],
      [usd(p.gas_usd) + ' gas · ' + usd(p.opportunity_usd) + ' idle cost', 'plan costs'],
      [pct(p.share, 3) + ' of ' + usdShort(p.pool_usd), 'your share of the allocation'],
      [usd(p.gross_usd), 'gross if it launches at implied'],
      [usd(p.net_usd) + ' · ' + usd(p.per_hour_usd) + '/hr', 'plan net'],
      [usd(p.breakeven_usd), 'break-even launch value'],
      [r.verdict.toUpperCase(), 'verdict'],
    ];
    var peers = nearestPeers(r).map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td>' + usdShort(x.tvl_usd) + '</td><td>' + usd(x.mcap_usd) + '</td><td>' + usd(x.predicted_usd) + '</td><td>×' + Math.exp(Math.abs(x.log_error)).toFixed(2) + '</td></tr>';
    }).join('');
    return header() +
      '<div class="overlay"><div class="sheet">' +
      '<a class="back" href="#/">← Back to the board</a>' +
      '<h2>' + esc(r.name) + '<span class="ct">' + esc(r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + D.rows.length + '</span></h2>' +
      '<div class="grid">' + cells.map(function (c) { return '<div class="cell"><div class="v">' + c[0] + '</div><div class="k">' + c[1] + '</div></div>'; }).join('') + '</div>' +
      '<h3>How this value is derived</h3>' +
      '<p>The model is one line fitted on the ' + M.n + ' traded peers: <b>' + esc(M.equation) + '</b>. ' +
      'At ' + esc(r.name) + '\'s TVL of ' + usd(r.tvl_usd) + ' it gives ' + usd(r.implied_value_usd) + '. The interval is the model\'s own ' +
      'leave-one-out residual band (10th to 90th percentile, ×' + Math.exp(M.loo.q10).toFixed(2) + ' to ×' + Math.exp(M.loo.q90).toFixed(2) + '), ' +
      'and the rank range is simulated from the same residuals: every row on the board is redrawn and re-ranked 400 times, and the range is the ' +
      '10th to 90th percentile of the ranks this row lands in. The five traded peers nearest in size, priced by the same line:</p>' +
      '<table class="mini"><tr><th>Peer</th><th>TVL</th><th>Actual cap</th><th>Model price</th><th>Error</th></tr>' + peers + '</table>' +
      '<h3>The farm plan, netted</h3>' +
      '<p>Verdict <b>' + r.verdict + '</b>: the plan nets <b>' + usd(p.net_usd) + '</b> if a token launches at the implied value — ' +
      'your ' + pct(p.share, 3) + ' of a ' + pct(FC.allocationShare, 0) + ' community allocation (' + usd(p.pool_usd) + ') is ' + usd(p.gross_usd) + ' gross, ' +
      'less ' + usd(p.gas_usd) + ' of gas and ' + usd(p.opportunity_usd) + ' of idle-capital cost over ' + p.weeks + ' weeks. ' +
      'It breaks even at a launch of ' + usd(p.breakeven_usd) + ', and pays ' + usd(p.per_hour_usd) + ' per active hour. ' +
      (p.verdict_note ? '<b>Note:</b> ' + esc(p.verdict_note) + '. ' : '') +
      'The value is conditional: this radar does not claim a token will launch, only what it would be worth at today\'s record and what farming it costs.</p>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '</div></div>';
  }

  // ---------- method ----------
  function methodSection() {
    var cand = M.candidates.map(function (c) {
      return '<tr' + (c.name === M.chosen ? ' class="chosen"' : '') + '><td>' + esc(c.name) + '</td><td>' + esc(c.terms) + '</td><td>' + c.n + '</td><td>×' + c.loo_median_factor.toFixed(2) + '</td><td>' + c.loo_r2.toFixed(3) + '</td></tr>';
    }).join('');
    var dead = D.set_aside.filter(function (x) { return x.reason === 'dead-record'; }).map(function (x) { return x.name; }).join(', ');
    return '<section class="block" id="method"><h2><span>§</span> The method, and how it was checked</h2>' +
      '<p><b>The anchor is the market itself.</b> Of the snapshot\'s 758 protocols, 144 carry a market cap. Sixteen of those records are ' +
      'not prices — a cap of zero, or a −1 sentinel — and are set aside by name (' + esc(dead) + '); the other <b>' + M.n + ' traded protocols are the fitting set</b>. ' +
      'A protocol that records no token is priced by the line those peers draw between TVL and market cap:</p>' +
      '<div class="eq">' + esc(M.equation) + ' &nbsp;·&nbsp; fitted on ' + M.n + ' peers</div>' +
      '<p><b>The line was chosen by cross-validation, not by taste.</b> Every candidate below was fitted on the same peers and scored by ' +
      'leave-one-out: each peer is priced by a model that never saw it, and the median miss is reported as a multiple. TVL alone won. ' +
      'Growth, age and chain count — the figures a radar is expected to use — each made the out-of-sample score worse, and the full model\'s ' +
      'growth coefficient is <b>' + M.growthCoefFull.toFixed(2) + '</b>: in this snapshot a one-week TVL spike marks mercenary capital the market ' +
      'prices lower, not momentum it pays for. Category medians, the previous version\'s approach, miss by half again as much. ' +
      'Those figures still work here — they set each plan\'s window and cadence and are printed beside every value — they are not allowed to move the price, because the peers say they should not.</p>' +
      '<table class="mini"><tr><th>Candidate model</th><th>Terms</th><th>Peers</th><th>Median miss (LOO)</th><th>R² (LOO)</th></tr>' + cand + '</table>' +
      '<p><b>Walk-forward check:</b> fitted on the ' + M.walkForward.train_n + ' peers listed before 2023 alone, the shipped line prices the ' +
      M.walkForward.test_n + ' peers listed after with a median miss of <b>×' + M.walkForward.median_factor.toFixed(2) + '</b>. ' +
      '<b>Interval check:</b> the board\'s 80% band is the leave-one-out residual band; on the peers themselves it contains the actual cap ' +
      pct(M.loo.coverage80, 0) + ' of the time, against the 80% it promises. Median miss ×' + M.loo.median_factor.toFixed(2) + ' is the honest ' +
      'uncertainty of pricing a token that does not exist from one snapshot: the ranges on the board are wide because the truth is wide. ' +
      'Rank ranges come from the same residuals by simulation — redraw every row, re-rank, 400 times — not from pricing every rival at the ' +
      'far end of its interval, which would hand nearly every row the whole board.</p>' +
      '<h3 style="color:var(--accent);font-size:14.5px;letter-spacing:.05em;text-transform:uppercase">Farm-plan arithmetic</h3>' +
      '<p>Every plan uses the same stated constants: a community allocation of <b>' + pct(FC.allocationShare, 0) + '</b> of implied value at launch; ' +
      'competing farmer capital of <b>' + pct(FC.aggregateFarmShare, 0) + ' of TVL</b> (never under ' + usd(FC.aggregateFarmFloor) + '); plan capital of ' +
      pct(FC.capitalPerTvl, 2) + ' of TVL, clamped to ' + usd(FC.capitalMin) + '–' + usd(FC.capitalMax) + '; idle capital priced at ' + pct(FC.opportunityApy, 1) + ' a year; ' +
      'gas per action of $6.50 on Ethereum, $0.15 on Solana, $1.20 on Bitcoin, $0.35 elsewhere. A plan is a <b>farm</b> when it nets at least ' +
      usd(FC.farmNetMin) + ', at least ' + usd(FC.farmPerHourMin) + ' per active hour, and at least ' + pct(FC.farmRocMin, 0) + ' on its capital for the season; ' +
      '<b>thin</b> when it merely pays for itself; <b>skip</b> when it does not. One downgrade applies on top: a protocol whose TVL fell 25% or more in ' +
      'seven days drops a rung, because a shrinking protocol is not farmed however the plan nets. Halve the allocation to 2.5% and every gross halves — ' +
      'the break-even column already states the launch value at which each plan exactly pays, so the sensitivity needs no trust.</p></section>';
  }

  // ---------- peers ----------
  function peersSection() {
    var body = D.peers.map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td>' + usdShort(x.tvl_usd) + '</td><td>' + usd(x.mcap_usd) + '</td><td>' + usd(x.predicted_usd) + '</td><td>×' + Math.exp(Math.abs(x.log_error)).toFixed(2) + '</td></tr>';
    }).join('');
    return '<section class="block" id="peers"><h2><span>§</span> The fitted peers: the model pricing tokens that exist</h2>' +
      '<p>These ' + D.peers.length + ' protocols already trade; the shipped line prices each from its TVL alone. This is the evidence the ' +
      'board\'s values rest on — the same fit, the same equation, nothing refitted per row. Errors are the in-sample miss; the leave-one-out ' +
      'median (×' + M.loo.median_factor.toFixed(2) + ') is the honest one and is the figure the headline uses.</p>' +
      '<table class="mini"><tr><th>Peer</th><th>TVL</th><th>Actual cap</th><th>Model price</th><th>Error</th></tr>' + body + '</table></section>';
  }

  // ---------- set aside ----------
  var REASON_TITLE = {
    live: 'Already trades (fitted peers, above)',
    'dead-record': 'Records a market cap that is not a price — set aside from the fit',
    'token-unpriced': 'A token is recorded but no market cap — already tokenised, nothing to rank',
    product: 'A wrapped, staked or bridged product of a token that already trades',
    versioned: 'A versioned deployment of another protocol',
  };
  function asideSection() {
    var groups = {};
    D.set_aside.forEach(function (x) { (groups[x.reason] = groups[x.reason] || []).push(x); });
    var html = '<section class="block" id="accounting"><h2><span>§</span> Every protocol accounted for</h2>' +
      '<p>The snapshot holds ' + META.scanned + ' protocols. ' + META.board_rows + ' are ranked on the board and ' + META.peers_fit + ' are the fitted peers above. ' +
      'The remaining ' + META.set_aside + ' are set aside, each for one stated reason — a radar that silently drops two thirds of its snapshot is not a radar.</p>';
    Object.keys(REASON_TITLE).forEach(function (k) {
      var g = groups[k];
      if (!g || k === 'live') return;
      html += '<h3 style="color:var(--accent);font-size:14.5px;letter-spacing:.05em;text-transform:uppercase">' + REASON_TITLE[k] + ' (' + g.length + ')</h3>' +
        '<div class="cols">' + g.map(function (x) { return '<div><b>' + esc(x.name) + '</b> · ' + usdShort(x.tvl_usd) + ' TVL</div>'; }).join('') + '</div>';
    });
    return html + '</section>';
  }

  function footer() {
    return '<footer>Launch Radar reads one sealed DefiLlama snapshot (' + esc(META.as_of) + ') and nothing else: no live prices, no launch ' +
      'announcements, no protocol is special-cased by name. An implied value is this entry\'s own claim about what a token would be worth if the ' +
      'protocol\'s record stayed as it is; it is not a prediction that a token will be issued, and a farm plan\'s net is conditional on a launch ' +
      'at that value. Snapshot source: ' + esc(META.source) + '.</footer>';
  }

  // ---------- wiring ----------
  function render() {
    var rt = route();
    app.innerHTML = rt.view === 'detail' ? detailView(rt.slug) : boardView(rt.q);
    window.scrollTo(0, 0);
    var q = document.getElementById('f-q');
    function push() {
      var params = new URLSearchParams();
      var v;
      v = document.getElementById('f-q').value; if (v) params.set('q', v);
      v = document.getElementById('f-cat').value; if (v) params.set('cat', v);
      v = document.getElementById('f-chain').value; if (v) params.set('chain', v);
      v = document.getElementById('f-verdict').value; if (v) params.set('verdict', v);
      if (document.getElementById('f-watch').checked) params.set('watch', '1');
      v = document.getElementById('f-sort').value; if (v && v !== 'rank') params.set('sort', v);
      var s = params.toString();
      history.replaceState(null, '', '#/' + (s ? '?' + s : ''));
      app.innerHTML = boardView(route().q);
      wire();
      var nq = document.getElementById('f-q');
      nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length);
    }
    function wire() {
      ['f-cat', 'f-chain', 'f-verdict', 'f-sort'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', push);
      });
      var w = document.getElementById('f-watch');
      if (w) w.addEventListener('change', push);
      var s = document.getElementById('f-q');
      if (s) s.addEventListener('input', push);
      document.querySelectorAll('tr[data-slug]').forEach(function (tr) {
        tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
      });
    }
    wire();
    if (q) { /* board rendered */ }
  }
  window.addEventListener('hashchange', render);
  render();
})();
