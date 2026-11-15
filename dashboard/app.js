// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts from the same
// board board.json carries) and renders the ranked board, a live-token comps view, filters and
// sorting, and a per-protocol detail drawer with the model's own derivation and the farm plan.
// No network: every byte it shows is in data.js. The view state lives in the location hash
// (#view=live, #cat=Lending, #tier=early, #q=gaunt, #sort=tvl, #p=gauntlet), so a view can be linked.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var root = document.getElementById('app');

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function fmtMult(x) { return x.toFixed(2) + 'x'; }
  function pctClass(n) { return n === null || n === undefined ? 'flat' : n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat'; }

  // ---------- tiny DOM helper ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  // ---------- state, from the hash ----------
  function readHash() {
    var s = { view: 'board', q: '', cat: 'all', tier: 'all', sort: 'implied', p: null };
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq < 0) return;
      var k = pair.slice(0, eq), v = decodeURIComponent(pair.slice(eq + 1));
      if (k in s) s[k] = v;
    });
    return s;
  }
  var state = readHash();
  function writeHash() {
    var parts = [];
    if (state.view !== 'board') parts.push('view=' + state.view);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.tier !== 'all') parts.push('tier=' + state.tier);
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.p) parts.push('p=' + state.p);
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }

  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var categories = [];
  var seenCat = {};
  D.rows.forEach(function (r) { var c = r.category || 'Uncategorised'; if (!seenCat[c]) { seenCat[c] = 1; categories.push(c); } });
  categories.sort();

  // ---------- static frame ----------
  var shell = el('div', { 'class': 'shell' });
  root.appendChild(shell);

  var asof = el('div', { 'class': 'asof' },
    el('div', null, 'snapshot ', el('b', { text: D.as_of })),
    el('div', { text: D.source.replace(/^DefiLlama /, 'DefiLlama · ') }));
  shell.appendChild(el('header', { 'class': 'masthead' },
    el('div', null,
      el('div', { 'class': 'kicker', text: 'Token launch radar' }),
      el('h1', null, 'Launch Radar ', el('span', { 'class': 'thin', text: '— what the next token is worth before it exists' })),
      el('p', { 'class': 'lede', text: 'Every protocol in the snapshot that records no token yet, ranked by an implied value anchored to what the market already pays for its traded peers — with the farm plan for each one. The watchlist is the floor, not the ceiling: the early rows below it are the point of a radar.' })),
    asof));

  function stat(v, k, amber) {
    return el('div', { 'class': 'stat' },
      el('div', { 'class': 'v' }, amber ? el('em', { text: v }) : document.createTextNode(v)),
      el('div', { 'class': 'k', text: k }));
  }
  shell.appendChild(el('div', { 'class': 'stats' },
    stat(String(D.scanned), 'protocols scanned'),
    stat(String(D.pre_token), 'record no token'),
    stat(String(D.board_size), 'ranked on the board', true),
    stat(D.watchlist_size + ' / ' + D.watchlist_size, 'watchlist covered'),
    stat(String(D.early_size), 'early rows below the floor'),
    stat(String(D.comps.peers), 'live peers anchor the model')));

  // ---------- method panel ----------
  var compRows = D.comps.categories.slice(0, 14).map(function (c) {
    return el('tr', null,
      el('td', { text: c.category }),
      el('td', { text: String(c.peers) }),
      el('td', { text: fmtMult(c.multiple) }),
      el('td', { text: fmtMult(c.low) + ' – ' + fmtMult(c.high) }));
  });
  var method = el('details', { 'class': 'method', id: 'method' },
    el('summary', null,
      el('span', { 'class': 'chev', text: '+' }),
      'How an implied value is derived ',
      el('span', { 'class': 'sub', text: 'model ' + D.model_version + ' — every figure below is read off this snapshot, nothing is hardcoded per protocol' })),
    el('div', { 'class': 'body' },
      el('div', null,
        el('h3', { text: 'The anchor: what the market pays its peers' }),
        el('p', { text: 'The snapshot\u2019s ' + D.comps.peers + ' live-token protocols (exchanges set aside) each give a market-cap-to-TVL ratio. A category\u2019s multiple is its peers\u2019 median ratio, shrunk toward the all-market median of ' + fmtMult(D.comps.median) + ' in proportion to how many peers it has, so a thin category borrows the market\u2019s anchor and a deep one stands on its own record. The range on every row is the same derivation at the peers\u2019 25th and 75th percentiles.' }),
        el('h3', { text: 'The four adjustments' }),
        el('ul', null,
          el('li', null, el('code', { text: 'momentum' }), document.createTextNode(' — the 7-day TVL change on a saturating curve, 1 + 0.45·g/(|g|+50): growth counts, a one-week spike cannot take over the board.')),
          el('li', null, el('code', { text: 'maturity' }), document.createTextNode(' — 0.78 rising toward 1.10 with tracked age: a protocol that has run for years with no token carries more evidence than a new one.')),
          el('li', null, el('code', { text: 'breadth' }), document.createTextNode(' — up to +12% for distribution across chains, read from the chains list.')),
          el('li', null, el('code', { text: 'scale' }), document.createTextNode(' — 0.82 at the $5M floor rising to 1.00 at $2.75B: the smallest protocols\u2019 tokens clear at a discount to peer multiples.'))),
        el('p', { text: 'Products whose TVL is another asset in transit or in wrapped, staked or bridged form are set aside with the exchanges: their value already belongs to a token that trades. Everything else that records no token is ranked, at any size.' })),
      el('div', null,
        el('h3', { text: 'Category multiples in this snapshot' }),
        el('table', { 'class': 'mini' },
          el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Peers' }), el('th', { text: 'Multiple' }), el('th', { text: 'Peer range' }))),
          el('tbody', null, compRows)),
        el('p', { text: 'A category with no traded peers is valued at the all-market median ' + fmtMult(D.comps.median) + ' (peer range ' + fmtMult(D.comps.low) + ' – ' + fmtMult(D.comps.high) + '). Open any row to see its own derivation, factor by factor.' }))));
  shell.appendChild(method);

  // ---------- controls ----------
  var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
  var catSel = el('select', { 'aria-label': 'Category' }, el('option', { value: 'all', text: 'All categories' }),
    categories.map(function (c) { return el('option', { value: c, text: c }); }));
  catSel.value = state.cat;
  var tierSel = el('select', { 'aria-label': 'Tier' },
    el('option', { value: 'all', text: 'Watchlist + early radar' }),
    el('option', { value: 'watchlist', text: 'Watchlist floor only' }),
    el('option', { value: 'early', text: 'Early radar only' }));
  tierSel.value = state.tier;
  var sortSel = el('select', { 'aria-label': 'Sort' },
    el('option', { value: 'implied', text: 'Implied value' }),
    el('option', { value: 'tvl', text: 'TVL' }),
    el('option', { value: 'change', text: '7-day change' }),
    el('option', { value: 'age', text: 'Track record (age)' }),
    el('option', { value: 'multiple', text: 'Category multiple' }));
  sortSel.value = state.sort;
  var count = el('span', { 'class': 'count' });
  var tabBoard = el('button', { type: 'button', text: 'Pre-token board' });
  var tabLive = el('button', { type: 'button', text: 'Already trading (comps)' });
  var controls = el('div', { 'class': 'controls' },
    el('div', { 'class': 'tabs', role: 'tablist' }, tabBoard, tabLive),
    search,
    el('label', null, 'Category', catSel),
    el('label', null, 'Tier', tierSel),
    el('label', null, 'Sort by', sortSel),
    count);
  shell.appendChild(controls);

  var wrap = el('div', { 'class': 'boardwrap', id: 'board' });
  shell.appendChild(wrap);
  shell.appendChild(el('p', { 'class': 'foot' },
    el('b', { text: 'Reading the board. ' }),
    document.createTextNode('An implied value is this model\u2019s claim about what a protocol\u2019s token would be worth if its record stayed as it is — not a prediction that a token will be issued, and not make.fun\u2019s claim. A protocol is listed as recording no token because the snapshot\u2019s record carries none; a record can lag the market. Farm plans are starting points written from each protocol\u2019s category, chains, size and age: check the protocol\u2019s own app before acting, and never pay anyone to claim an airdrop for you.')));

  // ---------- board rendering ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.tier === 'watchlist' && !r.on_watchlist) return false;
      if (state.tier === 'early' && r.on_watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      multiple: function (r) { return r.multiple; },
    }[state.sort];
    rows.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return rows;
  }

  function boardTable(rows) {
    var head = el('thead', null, el('tr', null,
      el('th', { 'class': 'l', text: '#' }),
      el('th', { 'class': 'l', text: 'Protocol' }),
      el('th', { 'class': 'l', text: 'Category' }),
      el('th', { 'class': 'l', text: 'Chains' }),
      el('th', { text: 'TVL' }),
      el('th', { text: '7d' }),
      el('th', { text: 'Tracked' }),
      el('th', { text: 'Peer x' }),
      el('th', { text: 'Implied value' }),
      el('th', { text: 'Range' })));
    var body = el('tbody', null, rows.map(function (r) {
      return el('tr', { 'class': r.rank <= 3 ? 'top' : '', 'aria-selected': state.p === r.slug ? 'true' : 'false', onclick: function () { openDetail(r.slug); } },
        el('td', { 'class': 'rank l', text: String(r.rank) }),
        el('td', { 'class': 'l' },
          el('div', { 'class': 'pname' }, document.createTextNode(r.name), r.on_watchlist ? el('span', { 'class': 'wl', text: 'WATCHLIST' }) : null),
          el('div', { 'class': 'pslug', text: r.slug })),
        el('td', { 'class': 'cat l', text: r.category || 'Uncategorised' }),
        el('td', { 'class': 'chains l', text: r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : '—' }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }),
        el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
        el('td', { 'class': 'mult' }, document.createTextNode(fmtMult(r.multiple) + ' '), el('small', { text: '(' + r.comp_peers + ')' })),
        el('td', { 'class': 'implied', text: fmtUsd(r.implied_value_usd) }),
        el('td', { 'class': 'range', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) }));
    }));
    return el('table', { 'class': 'board' }, head, body);
  }

  function liveTable() {
    var head = el('thead', null, el('tr', null,
      el('th', { 'class': 'l', text: 'Protocol' }),
      el('th', { 'class': 'l', text: 'Category' }),
      el('th', { text: 'Market cap (actual)' }),
      el('th', { text: 'TVL' }),
      el('th', { text: 'Cap / TVL' }),
      el('th', { text: '7d' })));
    var body = el('tbody', null, D.live.map(function (r) {
      return el('tr', null,
        el('td', { 'class': 'l' }, el('div', { 'class': 'pname', text: r.name }), el('div', { 'class': 'pslug', text: r.slug })),
        el('td', { 'class': 'cat l', text: r.category || 'Uncategorised' }),
        el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'mult', text: fmtMult(r.ratio) }),
        el('td', { 'class': 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }));
    }));
    return el('table', { 'class': 'board' }, head, body);
  }

  function render() {
    tabBoard.setAttribute('aria-selected', state.view === 'board' ? 'true' : 'false');
    tabLive.setAttribute('aria-selected', state.view === 'live' ? 'true' : 'false');
    wrap.textContent = '';
    if (state.view === 'live') {
      count.textContent = D.live.length + ' traded protocols — the peer set behind the multiples';
      wrap.appendChild(liveTable());
    } else {
      var rows = filtered();
      count.textContent = rows.length + ' of ' + D.board_size + ' protocols';
      wrap.appendChild(rows.length ? boardTable(rows) : el('div', { 'class': 'empty', text: 'No protocol matches this filter. Loosen the search or pick another category.' }));
    }
    writeHash();
  }

  // ---------- detail drawer ----------
  var drawerHost = el('div', null);
  root.appendChild(drawerHost);
  function closeDetail() { state.p = null; drawerHost.textContent = ''; render(); }
  function openDetail(slug) { state.p = slug; render(); drawDetail(); }
  function drawDetail() {
    drawerHost.textContent = '';
    var r = state.p ? bySlug[state.p] : null;
    if (!r) return;
    var anchor = r.tvl_usd * r.multiple;
    var lo = Math.min(r.implied_low_usd, r.implied_value_usd), hi = Math.max(r.implied_high_usd, r.implied_value_usd);
    var span = Math.max(1, hi - lo);
    var markPct = Math.min(100, Math.max(0, ((r.implied_value_usd - lo) / span) * 100));
    function fact(k, v) { return el('div', null, el('div', { 'class': 'k', text: k }), el('div', { 'class': 'v', text: v })); }
    function drow(label, why, val) {
      return el('tr', null, el('td', null, document.createTextNode(label + ' '), el('span', { 'class': 'why', text: why })), el('td', { text: val }));
    }
    var drawer = el('aside', { 'class': 'drawer', role: 'dialog', 'aria-label': r.name + ' detail' },
      el('button', { 'class': 'close', type: 'button', text: '×', onclick: closeDetail }),
      el('div', { 'class': 'kicker', text: 'Rank #' + r.rank + ' of ' + D.board_size + (r.on_watchlist ? ' · on the watchlist' : ' · early radar') }),
      el('h2', { text: r.name }),
      el('div', { 'class': 'cat', text: (r.category || 'Uncategorised') + ' · records no token' }),
      el('div', { 'class': 'big', text: fmtUsd(r.implied_value_usd) }),
      el('div', { 'class': 'bigrange', text: 'implied value · peer range ' + fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) }),
      el('div', { 'class': 'rangebar' },
        el('div', { 'class': 'fill', style: 'left:0;width:100%' }),
        el('div', { 'class': 'mark', style: 'left:' + markPct + '%' })),
      el('div', { 'class': 'facts' },
        fact('TVL', fmtUsd(r.tvl_usd)),
        fact('7-day TVL change', fmtPct(r.change_7d)),
        fact('Tracked since', r.listed_at || 'not reported'),
        fact('Track record', fmtAge(r.age_days)),
        fact('Chains', r.chains.length ? r.chains.join(', ') : 'not reported'),
        fact('Category peers trading', String(r.comp_peers))),
      el('h3', { text: 'How this value is derived' }),
      el('table', { 'class': 'derive' },
        drow('TVL anchor', 'TVL × category multiple ' + fmtMult(r.multiple), fmtUsd(Math.round(anchor))),
        drow('Momentum', '7-day change ' + fmtPct(r.change_7d) + ', saturating curve', '× ' + r.factors.momentum.toFixed(3)),
        drow('Maturity', fmtAge(r.age_days) + ' tracked with no token', '× ' + r.factors.maturity.toFixed(3)),
        drow('Breadth', r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains'), '× ' + r.factors.breadth.toFixed(3)),
        drow('Scale', 'size against the peer multiples', '× ' + r.factors.scale.toFixed(3)),
        el('tr', { 'class': 'total' }, el('td', { text: 'Implied value' }), el('td', { text: fmtUsd(r.implied_value_usd) }))),
      el('h3', { text: 'Farm plan' }),
      el('ol', { 'class': 'plan' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })),
      el('p', { 'class': 'foot', text: 'The plan is generated from this protocol\u2019s category, chains, TVL and age by the same playbook that writes board.json. Verify each step in the protocol\u2019s own app before acting.' }));
    drawerHost.appendChild(el('div', { 'class': 'backdrop', onclick: closeDetail }));
    drawerHost.appendChild(drawer);
  }

  // ---------- events ----------
  // A pasted or clicked deep link re-reads the whole state: the hash is the page's address scheme.
  function syncControls() {
    search.value = state.q;
    catSel.value = state.cat;
    tierSel.value = state.tier;
    sortSel.value = state.sort;
  }
  window.addEventListener('hashchange', function () {
    state = readHash();
    syncControls();
    render();
    if (state.p) drawDetail(); else drawerHost.textContent = '';
  });
  search.addEventListener('input', function () { state.q = search.value; render(); });
  catSel.addEventListener('change', function () { state.cat = catSel.value; render(); });
  tierSel.addEventListener('change', function () { state.tier = tierSel.value; render(); });
  sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
  tabBoard.addEventListener('click', function () { state.view = 'board'; render(); });
  tabLive.addEventListener('click', function () { state.view = 'live'; render(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.p) closeDetail(); });

  render();
  if (state.p) drawDetail();
})();
