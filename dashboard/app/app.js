/* =========================================================================
   Invertebrate Welfare Science Dashboard — client-side app
   Loads data/records.json (built by R/02_build_records.R) and does all
   filtering, aggregation and CSV export in the browser.
   ========================================================================= */
'use strict';

/* ------------------------------------------------------------------------
   Pure helpers (no DOM) — also exported for Node tests at the bottom.
   ------------------------------------------------------------------------ */
const Core = {
  /** Apply the filter state to the records. Within a facet: OR; across facets: AND. */
  filterRecords(records, f) {
    const text = (f.text || '').trim().toLowerCase();
    const any = (vals, sel) => !sel || sel.size === 0 || (vals || []).some(v => sel.has(v));
    return records.filter(r =>
      r.y >= f.yearMin && r.y <= f.yearMax &&
      (f.includeNoci || !r.n) &&
      (!f.usFirst || r.uf) &&
      any(r.tx, f.taxa) && any(r.th, f.themes) && any(r.cx, f.contexts) &&
      (!f.jgroups || f.jgroups.size === 0 || f.jgroups.has(r.jg)) &&
      (!f.types || f.types.size === 0 || f.types.has(r.ty)) &&
      (!text || (r.t || '').toLowerCase().includes(text))
    );
  },

  years(min, max) { const out = []; for (let y = min; y <= max; y++) out.push(y); return out; },

  /** Count records per year. */
  perYear(records, years) {
    const m = new Map(years.map(y => [y, 0]));
    for (const r of records) if (m.has(r.y)) m.set(r.y, m.get(r.y) + 1);
    return years.map(y => m.get(y));
  },

  /** Count per year for each value of a multi-label field (e.g. 'tx', 'th'). */
  perYearBy(records, years, field, keys) {
    const idx = new Map(years.map((y, i) => [y, i]));
    const out = Object.fromEntries(keys.map(k => [k, years.map(() => 0)]));
    for (const r of records) {
      const i = idx.get(r.y); if (i === undefined) continue;
      const vals = Array.isArray(r[field]) ? r[field] : [r[field]];
      for (const v of vals) if (out[v]) out[v][i]++;
    }
    return out;
  },

  /** Totals for a (possibly multi-label) field, sorted descending. */
  countBy(records, field) {
    const m = new Map();
    for (const r of records) {
      const vals = Array.isArray(r[field]) ? r[field] : [r[field]];
      for (const v of vals) if (v != null && v !== '') m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  },

  /** Ratio of two summed windows, guarding against tiny denominators. */
  growth(series, years, fromYears, toYears) {
    const sum = ys => ys.reduce((s, y) => s + (series[years.indexOf(y)] || 0), 0);
    const a = sum(fromYears), b = sum(toYears);
    return a >= 3 ? b / a : null;
  },

  /** conceptual:empirical ratio text from a {group: n} object. */
  ratioText(obj) {
    if (!obj) return null;
    const emp = obj.empirical || 0, con = obj['conceptual/theoretical/methodological/review'] || 0;
    if (!emp) return null;
    return `${(con / emp).toFixed(2)} : 1 (n = ${emp + con})`;
  },

  /**
   * Rows of the "Annual indicators" table, in the order of the IWRS brief.
   * Publication rows use the filtered records; curated rows come from meta.manual.
   */
  indicatorRows(view, meta, years) {
    const rows = [];
    const L = meta.labels;
    const group = label => rows.push({ kind: 'group', label });
    const fromManual = (key, label, opts = {}) => {
      const m = (meta.manual || {})[key];
      rows.push({ kind: opts.sub ? 'sub' : 'row', label, key,
        status: m ? (opts.status || 'manual') : 'pending', money: !!opts.money,
        values: m ? years.map(y => (m[y] != null ? m[y] : 0)) : null });
    };

    group('Peer-reviewed publications');
    rows.push({ kind: 'row', label: 'Total publications', key: 'publications', status: 'live', values: Core.perYear(view, years) });
    const th = Core.perYearBy(view, years, 'th', Object.keys(L.themes));
    for (const k of ['sentience', 'emotion', 'affect', 'consciousness', 'welfare', 'pain']) {
      if (L.themes[k]) rows.push({ kind: 'sub', label: L.themes[k], key: 'theme_' + k, status: 'live', values: th[k] });
    }
    const st = meta.validation && meta.validation.study_type;
    const per = st && st.by_period ? Object.entries(st.by_period).map(([p, o]) => {
      const t = Core.ratioText(o); return t ? `${p}: ${t}` : null; }).filter(Boolean) : [];
    rows.push({ kind: 'row', label: 'Conceptual : empirical ratio', key: 'ratio',
      status: st ? 'sample' : 'pending', values: null,
      text: st ? (per.length ? per.join(' · ') : Core.ratioText(st.overall)) : null });

    group('Journal distribution');
    const jg = Core.perYearBy(view, years, 'jg', ['welfare', 'entomology', 'multidisciplinary', 'other']);
    for (const k of ['welfare', 'entomology', 'multidisciplinary', 'other']) {
      rows.push({ kind: 'sub', label: L.jgroups[k] || k, key: 'journals_' + k, status: 'live', values: jg[k] });
    }

    group('Conferences & events');
    fromManual('talks', 'Talks at major conferences (ESA, ICE, IFF…)');
    fromManual('sessions', 'Dedicated symposia, workshops, panels');
    fromManual('events', 'Academic events of any kind');

    group('Theses');
    fromManual('theses_phd', 'PhD dissertations', { sub: true });
    fromManual('theses_ms', "Master's theses", { sub: true });
    fromManual('theses_openalex', 'Dissertations indexed in OpenAlex (floor)', { sub: true, status: 'live' });

    group('Funding from non-EA funders');
    fromManual('grants_n', 'Number of grants', { sub: true });
    fromManual('grants_usd', 'Total value (USD)', { sub: true, money: true });

    group('Media');
    fromManual('media', 'Media mentions');
    return rows;
  },

  csvEscape(v) {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
};

if (typeof module !== 'undefined' && module.exports) { module.exports = Core; }

/* ------------------------------------------------------------------------
   Browser app
   ------------------------------------------------------------------------ */
if (typeof window !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  const fmt = n => n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US');
  const pct = (x, d = 0) => x == null || Number.isNaN(x) ? '—' : (100 * x).toFixed(d) + '%';
  const regionName = (() => {
    try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); return c => { try { return dn.of(c) || c; } catch { return c; } }; }
    catch { return c => c; }
  })();

  let META, RECS, YEARS, F, VIEW = [], PAGE = 0;
  const charts = {};
  const PAGE_SIZE = 50;

  // ---- Colour roles ----------------------------------------------------
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const slot = i => css(`--s${(i % 7) + 1}`);
  const colorMaps = () => {
    const taxa = Object.keys(META.labels.taxa), themes = Object.keys(META.labels.themes);
    const jg = { welfare: css('--s1'), entomology: css('--s2'), multidisciplinary: css('--s3'),
                 other: css('--s-other'), unknown: css('--s-none') };
    return {
      taxa: Object.fromEntries(taxa.map((k, i) => [k, slot(i)])),
      themes: Object.fromEntries(themes.map((k, i) => [k, slot(i)])),
      jgroups: jg
    };
  };
  const withAlpha = (hex, a) => {
    const h = hex.replace('#', ''); if (h.length !== 6) return hex;
    const n = parseInt(h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // ---- Load ------------------------------------------------------------
  fetch('data/records.json')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(err => { $('loading').textContent = 'Could not load data/records.json (' + err.message + '). If you opened the file directly, serve the folder instead: python3 -m http.server'; });

  function init(data) {
    META = data.meta; RECS = data.records;
    const maxYear = Math.max(META.years.to, ...RECS.map(r => r.y).filter(Boolean));
    YEARS = Core.years(META.years.from, Math.min(maxYear, META.years.to));
    $('demo-banner').hidden = !META.demo;
    $('snapshot').textContent = `OpenAlex snapshot · ${META.retrieved_at || '—'}`;
    buildFilters();
    resetFilters(false);
    bindUI();
    $('loading').hidden = true; $('dash').hidden = false;
    renderValidationStatic();
    renderProvenance();
    update();
  }

  // ---- Filters ---------------------------------------------------------
  function defaultFilters() {
    return { yearMin: YEARS[0], yearMax: YEARS[YEARS.length - 1], text: '',
             taxa: new Set(), themes: new Set(), contexts: new Set(), jgroups: new Set(), types: new Set(),
             includeNoci: false, usFirst: false };
  }

  function buildCheckboxes(containerId, labels, key, field, colors) {
    const base = RECS.filter(r => !r.n);
    const counts = Object.fromEntries(Core.countBy(base, field));
    $(containerId).innerHTML = Object.entries(labels).map(([k, lab]) => `
      <label class="f-opt">
        <input type="checkbox" data-facet="${key}" value="${k}">
        ${colors ? `<span class="swatch" style="background:${colors[k] || 'transparent'}"></span>` : ''}
        <span>${lab}</span><span class="n">${fmt(counts[k] || 0)}</span>
      </label>`).join('');
  }

  function buildFilters() {
    const opts = YEARS.map(y => `<option value="${y}">${y}${y === META.years.to ? ' (partial)' : ''}</option>`).join('');
    $('f-year-min').innerHTML = opts; $('f-year-max').innerHTML = opts;
    const cm = colorMaps();
    buildCheckboxes('f-taxa', META.labels.taxa, 'taxa', 'tx', cm.taxa);
    buildCheckboxes('f-themes', META.labels.themes, 'themes', 'th', cm.themes);
    buildCheckboxes('f-contexts', META.labels.contexts, 'contexts', 'cx');
    buildCheckboxes('f-jgroups', META.labels.jgroups, 'jgroups', 'jg', cm.jgroups);
    buildCheckboxes('f-types', { article: 'Article', review: 'Review' }, 'types', 'ty');
  }

  function resetFilters(run = true) {
    F = defaultFilters();
    $('f-year-min').value = F.yearMin; $('f-year-max').value = F.yearMax;
    $('f-text').value = '';
    document.querySelectorAll('[data-facet]').forEach(cb => { cb.checked = false; });
    $('f-noci').checked = false; $('f-us').checked = false;
    if (run) update();
  }

  function bindUI() {
    $('f-year-min').addEventListener('change', e => { F.yearMin = +e.target.value; if (F.yearMin > F.yearMax) { F.yearMax = F.yearMin; $('f-year-max').value = F.yearMax; } update(); });
    $('f-year-max').addEventListener('change', e => { F.yearMax = +e.target.value; if (F.yearMax < F.yearMin) { F.yearMin = F.yearMax; $('f-year-min').value = F.yearMin; } update(); });
    let t; $('f-text').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { F.text = e.target.value; update(); }, 250); });
    document.addEventListener('change', e => {
      const cb = e.target.closest('[data-facet]'); if (!cb) return;
      const set = F[cb.dataset.facet]; cb.checked ? set.add(cb.value) : set.delete(cb.value); update();
    });
    $('f-noci').addEventListener('change', e => { F.includeNoci = e.target.checked; update(); });
    $('f-us').addEventListener('change', e => { F.usFirst = e.target.checked; update(); });
    $('btn-reset').addEventListener('click', () => resetFilters());
    $('btn-download').addEventListener('click', downloadCSV);
    $('btn-verify').addEventListener('click', verifyLive);
    $('btn-ind-csv').addEventListener('click', downloadIndicators);
    $('pg-prev').addEventListener('click', () => { PAGE = Math.max(0, PAGE - 1); renderRecords(); });
    $('pg-next').addEventListener('click', () => { PAGE++; renderRecords(); });

    document.querySelectorAll('.view-tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
      const rec = b.dataset.view === 'records';
      $('view-dashboard').hidden = rec; $('view-records').hidden = !rec;
      if (rec) { PAGE = 0; renderRecords(); }
    }));

    // Mobile drawer
    const open = o => { $('sidebar').classList.toggle('open', o); $('sidebar-backdrop').classList.toggle('open', o); };
    $('filters-toggle').addEventListener('click', () => open(true));
    $('sidebar-close').addEventListener('click', () => open(false));
    $('sidebar-backdrop').addEventListener('click', () => open(false));
    document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => {
      open(false);
      if (!$('view-dashboard').hidden) return;
      document.querySelector('.view-tabs [data-view="dashboard"]').click();
    }));

    // Highlight the nav entry for the section in view
    const links = [...document.querySelectorAll('.nav a')];
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
    }), { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('#view-dashboard .section').forEach(s => io.observe(s));

    // "Table" toggles on chart cards (accessible alternative to colour)
    document.querySelectorAll('.card[data-chart]').forEach(card => {
      const btn = document.createElement('button');
      btn.className = 'table-toggle'; btn.type = 'button'; btn.textContent = 'Table';
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        const on = card.classList.toggle('show-table');
        btn.textContent = on ? 'Chart' : 'Table'; btn.setAttribute('aria-pressed', on);
        if (on) renderChartTable(card);
      });
      card.appendChild(btn);
      const tw = document.createElement('div'); tw.className = 'chart-table table-wrap';
      card.appendChild(tw);
    });

    // Re-colour charts when the OS theme flips
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { buildFilters(); syncCheckboxes(); update(); });
  }

  function syncCheckboxes() {
    document.querySelectorAll('[data-facet]').forEach(cb => { cb.checked = F[cb.dataset.facet].has(cb.value); });
  }

  // ---- Main update -----------------------------------------------------
  function update() {
    VIEW = Core.filterRecords(RECS, F);
    $('match-count').textContent = `${fmt(VIEW.length)} of ${fmt(RECS.length)} works`;
    const ys = YEARS.filter(y => y >= F.yearMin && y <= F.yearMax);
    applyChartDefaults();
    renderKPIs(ys);
    renderIndicators(ys);
    renderTrends(ys);
    renderTaxa(ys);
    renderJournals(ys);
    renderGeography(ys);
    renderCited();
    if (!$('view-records').hidden) { PAGE = 0; renderRecords(); }
    document.querySelectorAll('.card.show-table').forEach(renderChartTable);
  }

  function applyChartDefaults() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--ink-2');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.useBorderRadius = true;
    Chart.defaults.plugins.legend.labels.borderRadius = 3;
    Chart.defaults.plugins.tooltip.backgroundColor = css('--ink');
    Chart.defaults.plugins.tooltip.titleColor = css('--page');
    Chart.defaults.plugins.tooltip.bodyColor = css('--page');
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
  }

  /** Create or update a chart in place (keeps tooltips/hover state cheap). */
  function draw(id, config) {
    if (charts[id]) { charts[id].destroy(); }
    charts[id] = new Chart($(id), config);
  }

  const yearLabel = y => y === META.years.to ? `${y}*` : String(y);
  const axis = (extra = {}) => ({ grid: { color: css('--grid') }, border: { color: css('--axis') }, ticks: { color: css('--muted') }, ...extra });
  const noGrid = (extra = {}) => ({ grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted') }, ...extra });
  const lineDs = (label, data, color) => ({
    label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
    pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: color, pointBorderColor: css('--surface'), pointBorderWidth: 1.5,
    tension: 0.25,
    segment: { borderDash: ctx => (YEARSHOWN[ctx.p1DataIndex] === META.years.to ? [4, 4] : undefined) }
  });
  let YEARSHOWN = [];

  // ---- KPIs & findings -------------------------------------------------
  function renderKPIs(ys) {
    const series = Core.perYear(VIEW, YEARS);
    const complete = YEARS.filter(y => y < META.years.to);
    const base = Object.fromEntries((META.baseline || []).map(b => [b.year, b.all_works]));
    const norm = YEARS.map((y, i) => base[y] ? series[i] / base[y] : null);
    const first3 = complete.slice(0, 3), last3 = complete.slice(-3);
    const gRaw = Core.growth(series, YEARS, first3, last3);
    const normSum = arr => arr.reduce((s, y) => s + (norm[YEARS.indexOf(y)] || 0), 0);
    const gNorm = normSum(first3) > 0 ? normSum(last3) / normSum(first3) : null;
    const ctry = new Set(VIEW.flatMap(r => r.co || []));
    const usShare = VIEW.length ? VIEW.filter(r => r.uf).length / VIEW.length : null;
    const reviews = VIEW.filter(r => r.ty === 'review').length;
    const v = META.validation || {};
    const st = v.study_type && v.study_type.overall;
    let ratio = 'pending', ratioSub = 'from the hand-coded sample (03_validation.R)';
    if (st) {
      const emp = st.empirical || 0, con = st['conceptual/theoretical/methodological/review'] || 0;
      ratio = emp ? `${(con / emp).toFixed(2)} : 1` : '—';
      ratioSub = `conceptual : empirical, n = ${emp + con} coded papers`;
    }
    const kpis = [
      ['Papers in view', fmt(VIEW.length), `${ys[0]}–${ys[ys.length - 1]}${ys.includes(META.years.to) ? ' (last year partial)' : ''}`],
      ['Growth, raw', gRaw ? `×${gRaw.toFixed(1)}` : '—', `${first3[0]}–${first3[2]} vs ${last3[0]}–${last3[2]}`],
      ['Growth, normalised', gNorm ? `×${gNorm.toFixed(1)}` : '—', 'per 100k works indexed in OpenAlex'],
      ['Countries', fmt(ctry.size), 'with at least one author'],
      ['US first author', pct(usShare), 'share of papers in view'],
      ['Conceptual : empirical', ratio, ratioSub],
    ];
    $('kpis').innerHTML = kpis.map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');

    // Findings: short, data-driven sentences
    const out = [];
    if (VIEW.length) {
      const peakIdx = complete.reduce((b, y) => (series[YEARS.indexOf(y)] > series[YEARS.indexOf(b)] ? y : b), complete[0]);
      out.push(`The busiest complete year in view is <strong>${peakIdx}</strong>, with ${fmt(series[YEARS.indexOf(peakIdx)])} papers.`);
      const byTaxon = Core.perYearBy(VIEW, YEARS, 'tx', Object.keys(META.labels.taxa));
      const growths = Object.entries(byTaxon)
        .map(([k, s]) => [k, Core.growth(s, YEARS, first3, last3), s.reduce((a, b) => a + b, 0)])
        .filter(([, g, n]) => g && n >= 20).sort((a, b) => b[1] - a[1]);
      if (growths.length) out.push(`Fastest-growing taxon group (≥20 papers): <strong>${META.labels.taxa[growths[0][0]]}</strong>, ×${growths[0][1].toFixed(1)} between ${first3[0]}–${first3[2]} and ${last3[0]}–${last3[2]}.`);
      const topJ = Core.countBy(VIEW.filter(r => r.j), 'j')[0];
      if (topJ) out.push(`Most frequent journal: <strong>${topJ[0]}</strong> (${fmt(topJ[1])} papers).`);
      out.push(`${pct(reviews / VIEW.length)} of papers in view are reviews.`);
    } else out.push('No papers match the current filters.');
    $('findings').innerHTML = out.map(s => `<li>${s}</li>`).join('');
  }

  // ---- Annual indicators -----------------------------------------------
  const usd = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${fmt(Math.round(n))}`;
  let IND_ROWS = [], IND_YEARS = [];

  function renderIndicators(ys) {
    IND_YEARS = ys;
    IND_ROWS = Core.indicatorRows(VIEW, META, ys);
    const ncol = ys.length + 3;
    const badge = s => ({ live: '<span class="status live">OpenAlex</span>',
      sample: '<span class="status manual">Coded sample</span>',
      manual: '<span class="status manual">Curated</span>',
      pending: '<span class="status pending">Pending</span>' })[s] || '';
    $('ind-table').innerHTML =
      `<thead><tr><th>Indicator</th><th>Source</th>${ys.map(y => `<th class="num">${yearLabel(y)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>` +
      IND_ROWS.map(r => {
        if (r.kind === 'group') return `<tr class="group"><td colspan="${ncol}">${esc(r.label)}</td></tr>`;
        const cls = r.kind === 'sub' ? 'sub' : '';
        if (!r.values) {
          const body = r.text ? `<td colspan="${ys.length + 1}">${esc(r.text)}</td>`
                              : `<td colspan="${ys.length + 1}" class="pending">pending</td>`;
          return `<tr class="${cls}"><td>${esc(r.label)}</td><td>${badge(r.status)}</td>${body}</tr>`;
        }
        const f = r.money ? usd : fmt;
        const tot = r.values.reduce((a, b) => a + (b || 0), 0);
        return `<tr class="${cls}"><td>${esc(r.label)}</td><td>${badge(r.status)}</td>` +
          r.values.map(v => `<td class="num${v ? '' : ' zero'}">${f(v || 0)}</td>`).join('') +
          `<td class="num"><strong>${f(tot)}</strong></td></tr>`;
      }).join('') + '</tbody>';
  }

  function downloadIndicators() {
    const head = ['indicator', 'source', ...IND_YEARS, 'total', 'note'];
    const lines = [head.join(',')];
    let grp = '';
    for (const r of IND_ROWS) {
      if (r.kind === 'group') { grp = r.label; continue; }
      const label = r.kind === 'sub' ? `${grp}: ${r.label}` : r.label;
      const vals = r.values ? r.values : IND_YEARS.map(() => '');
      const tot = r.values ? r.values.reduce((a, b) => a + (b || 0), 0) : '';
      lines.push([label, r.status, ...vals, tot, r.text || (r.values ? '' : 'pending')].map(Core.csvEscape).join(','));
    }
    saveBlob(lines.join('\n'), `iwrs-annual-indicators-${IND_YEARS[0]}-${IND_YEARS[IND_YEARS.length - 1]}.csv`);
  }

  function saveBlob(text, name) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Trends ----------------------------------------------------------
  function renderTrends(ys) {
    YEARSHOWN = ys;
    const series = Core.perYear(VIEW, ys);
    const s1 = css('--s1');
    draw('yearChart', {
      type: 'bar',
      data: { labels: ys.map(yearLabel), datasets: [{
        label: 'Papers', data: series,
        backgroundColor: ys.map(y => y === META.years.to ? withAlpha(s1, 0.4) : s1),
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 36 }] },
      options: { plugins: { legend: { display: false },
        tooltip: { callbacks: { title: it => it[0].label.replace('*', ' (partial year)') } } },
        scales: { x: noGrid(), y: axis({ beginAtZero: true, ticks: { precision: 0, color: css('--muted') } }) } }
    });

    const base = Object.fromEntries((META.baseline || []).map(b => [b.year, b.all_works]));
    const norm = ys.map((y, i) => base[y] ? +(series[i] / base[y] * 1e5).toFixed(2) : null);
    draw('normChart', {
      type: 'line',
      data: { labels: ys.map(yearLabel), datasets: [lineDs('Per 100k works', norm, css('--s1'))] },
      options: { plugins: { legend: { display: false } }, interaction: { mode: 'index', intersect: false },
        scales: { x: noGrid(), y: axis({ beginAtZero: true }) } }
    });

    const cm = colorMaps();
    const keys = Object.keys(META.labels.themes);
    const by = Core.perYearBy(VIEW, ys, 'th', keys);
    draw('themeChart', {
      type: 'line',
      data: { labels: ys.map(yearLabel), datasets: keys.map(k => lineDs(META.labels.themes[k], by[k], cm.themes[k])) },
      options: { interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } },
        scales: { x: noGrid(), y: axis({ beginAtZero: true, ticks: { precision: 0, color: css('--muted') } }) } }
    });
  }

  // ---- Taxa & contexts -------------------------------------------------
  function hbar(id, entries, colors, label = 'Papers') {
    draw(id, {
      type: 'bar',
      data: { labels: entries.map(e => e[0]), datasets: [{ label, data: entries.map(e => e[1]),
        backgroundColor: colors, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left', maxBarThickness: 22 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: axis({ beginAtZero: true, ticks: { precision: 0, color: css('--muted') } }),
                  y: noGrid({ ticks: { color: css('--ink-2'), autoSkip: false } }) } }
    });
  }

  function renderTaxa(ys) {
    const cm = colorMaps();
    const tKeys = Object.keys(META.labels.taxa);
    const tCounts = Object.fromEntries(Core.countBy(VIEW, 'tx'));
    hbar('taxaChart', tKeys.map(k => [META.labels.taxa[k], tCounts[k] || 0]), tKeys.map(k => cm.taxa[k]));

    const cKeys = Object.keys(META.labels.contexts);
    const cCounts = Object.fromEntries(Core.countBy(VIEW, 'cx'));
    const ce = cKeys.map(k => [META.labels.contexts[k], cCounts[k] || 0]).sort((a, b) => b[1] - a[1]);
    hbar('contextChart', ce, css('--s1'));

    const by = Core.perYearBy(VIEW, ys, 'tx', tKeys);
    draw('taxaTrendChart', {
      type: 'line',
      data: { labels: ys.map(yearLabel), datasets: tKeys.map(k => lineDs(META.labels.taxa[k], by[k], cm.taxa[k])) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
        scales: { x: noGrid(), y: axis({ beginAtZero: true, ticks: { precision: 0, color: css('--muted') } }) } }
    });
  }

  // ---- Journals --------------------------------------------------------
  function renderJournals(ys) {
    const cm = colorMaps();
    const order = ['welfare', 'entomology', 'multidisciplinary', 'other', 'unknown'].filter(k => META.labels.jgroups[k]);
    const by = Core.perYearBy(VIEW, ys, 'jg', order);
    draw('jgroupChart', {
      type: 'bar',
      data: { labels: ys.map(yearLabel), datasets: order.map(k => ({
        label: META.labels.jgroups[k], data: by[k], backgroundColor: cm.jgroups[k],
        borderColor: css('--surface'), borderWidth: { top: 2 }, borderSkipped: 'bottom', maxBarThickness: 40 })) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
        scales: { x: noGrid({ stacked: true }), y: axis({ stacked: true, beginAtZero: true, ticks: { precision: 0, color: css('--muted') } }) } }
    });

    // Focal journals table
    const focal = META.focal_journals || [];
    const lc = s => (s || '').toLowerCase();
    const rows = focal.map(j => {
      const per = ys.map(y => VIEW.filter(r => r.y === y && lc(r.j) === lc(j)).length);
      return [j, per, per.reduce((a, b) => a + b, 0)];
    });
    $('focal-table').innerHTML =
      `<thead><tr><th>Journal</th>${ys.map(y => `<th class="num">${yearLabel(y)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>` +
      rows.map(([j, per, tot]) => `<tr><td>${j}</td>${per.map(n => `<td class="num${n ? '' : ' zero'}">${n}</td>`).join('')}<td class="num"><strong>${tot}</strong></td></tr>`).join('') +
      '</tbody>';

    const jgOf = {}; VIEW.forEach(r => { if (r.j) jgOf[r.j] = r.jg; });
    const top = Core.countBy(VIEW.filter(r => r.j), 'j').slice(0, 12);
    hbar('topJournalChart', top, top.map(([j]) => cm.jgroups[jgOf[j]] || cm.jgroups.other));
  }

  // ---- Geography -------------------------------------------------------
  function renderGeography(ys) {
    const top = Core.countBy(VIEW, 'co').slice(0, 15).map(([c, n]) => [regionName(c), n]);
    hbar('countryChart', top, css('--s1'));
    const share = ys.map(y => {
      const rs = VIEW.filter(r => r.y === y);
      return rs.length ? +(100 * rs.filter(r => r.uf).length / rs.length).toFixed(1) : null;
    });
    draw('usChart', {
      type: 'line',
      data: { labels: ys.map(yearLabel), datasets: [lineDs('US first author (%)', share, css('--s1'))] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y}%` } } },
        scales: { x: noGrid(), y: axis({ beginAtZero: true, max: 100, ticks: { callback: v => v + '%', color: css('--muted') } }) } }
    });
  }

  // ---- Most cited ------------------------------------------------------
  const link = r => r.d ? `https://doi.org/${r.d}` : `https://openalex.org/${r.i}`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tags = (arr, labels) => (arr || []).map(k => `<span class="tag">${esc(labels[k] || k)}</span>`).join('');

  function renderCited() {
    const top = [...VIEW].sort((a, b) => b.c - a.c).slice(0, 10);
    $('cited-table').innerHTML = `<thead><tr><th class="num">#</th><th>Title</th><th class="num">Year</th><th>Journal</th><th>Taxa</th><th class="num">Citations</th></tr></thead><tbody>` +
      top.map((r, i) => `<tr><td class="num">${i + 1}</td><td><a href="${link(r)}" target="_blank" rel="noopener">${esc(r.t)}</a></td>
        <td class="num">${r.y}</td><td>${esc(r.j || '—')}</td><td>${tags(r.tx, META.labels.taxa)}</td><td class="num">${fmt(r.c)}</td></tr>`).join('') +
      '</tbody>';
  }

  // ---- Records view ----------------------------------------------------
  function renderRecords() {
    const sorted = [...VIEW].sort((a, b) => b.y - a.y || b.c - a.c);
    const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    PAGE = Math.min(PAGE, pages - 1);
    const rows = sorted.slice(PAGE * PAGE_SIZE, (PAGE + 1) * PAGE_SIZE);
    $('records-table').innerHTML = `<thead><tr><th>Title</th><th class="num">Year</th><th>Journal</th><th>Taxa</th><th>Themes</th><th class="num">Cites</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td><a href="${link(r)}" target="_blank" rel="noopener">${esc(r.t)}</a>${r.ty === 'review' ? ' <span class="tag">review</span>' : ''}</td>
        <td class="num">${r.y}</td><td>${esc(r.j || '—')}</td><td>${tags(r.tx, META.labels.taxa)}</td><td>${tags(r.th, META.labels.themes)}</td><td class="num">${fmt(r.c)}</td></tr>`).join('') +
      '</tbody>';
    $('pg-info').textContent = `Page ${PAGE + 1} of ${pages}`;
    $('pg-prev').disabled = PAGE === 0; $('pg-next').disabled = PAGE >= pages - 1;
  }

  // ---- Chart → table (accessibility) -----------------------------------
  function renderChartTable(card) {
    const ch = charts[card.dataset.chart]; if (!ch) return;
    const labels = ch.data.labels, ds = ch.data.datasets;
    card.querySelector('.chart-table').innerHTML = `<table class="data-table"><thead><tr><th></th>${ds.map(d => `<th class="num">${esc(d.label)}</th>`).join('')}</tr></thead><tbody>` +
      labels.map((l, i) => `<tr><td>${esc(l)}</td>${ds.map(d => `<td class="num">${d.data[i] == null ? '—' : fmt(d.data[i])}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>';
  }

  // ---- CSV export ------------------------------------------------------
  function downloadCSV() {
    const L = META.labels;
    const head = ['openalex_id', 'doi', 'title', 'year', 'journal', 'journal_group', 'type', 'citations', 'oa_status', 'language', 'countries', 'taxa', 'themes', 'contexts', 'nociception_only', 'us_first_author'];
    const lines = [head.join(',')].concat(VIEW.map(r => [
      r.i, r.d, r.t, r.y, r.j, L.jgroups[r.jg] || r.jg, r.ty, r.c, r.oa, r.l, r.co,
      (r.tx || []).map(k => L.taxa[k]), (r.th || []).map(k => L.themes[k]), (r.cx || []).map(k => L.contexts[k]), r.n, r.uf
    ].map(Core.csvEscape).join(',')));
    saveBlob(lines.join('\n'), `invertebrate-welfare-${F.yearMin}-${F.yearMax}-${VIEW.length}works.csv`);
  }

  // ---- Validation & provenance ------------------------------------------
  function apiUrl(q) {
    const p = new URLSearchParams({ 'search.title_and_abstract.exact': q, filter: META.provenance.filter });
    return 'https://api.openalex.org/works?' + p.toString();
  }

  function renderValidationStatic() {
    const v = META.validation || {};
    const rec = v.recall, pre = v.precision, ag = v.agreement;
    const k = [
      ['Works in snapshot', fmt(META.n_records), 'after merging taxon groups'],
      ['Recall (gold set)', rec ? pct(rec.value) : 'pending', rec ? `${rec.found} of ${rec.n} known papers retrieved` : 'add DOIs to data/validation/gold_set.csv'],
      ['Precision (sample)', pre ? pct(pre.value) : 'pending', pre ? `${pre.relevant}/${pre.n} relevant · 95% CI ${pct(pre.ci95[0])}–${pct(pre.ci95[1])}` : 'hand-code the random sample'],
      ['Coder agreement', ag && ag.kappa_relevant != null ? `κ = ${(+ag.kappa_relevant).toFixed(2)}` : 'pending', ag ? `relevance · study type κ = ${ag.kappa_study_type != null ? (+ag.kappa_study_type).toFixed(2) : '—'}` : "Cohen's kappa, two coders"],
    ];
    $('val-kpis').innerHTML = k.map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');

    const prov = META.provenance || {}, q = prov.queries || {}, counts = prov.group_counts || {};
    $('val-queries').innerHTML = Object.keys(q).map(g => `
      <div class="query-block">
        <div class="query-head"><strong>${esc(META.labels.taxa[g] || g)}</strong>
          <span class="muted">${fmt(counts[g])} works at snapshot</span>
          <button class="btn-copy" data-copy="${esc(q[g])}">Copy</button>
          <a href="${apiUrl(q[g])}" target="_blank" rel="noopener">Open in OpenAlex API ↗</a></div>
        <div class="query-box">${esc(q[g])}</div>
      </div>`).join('') + `<p class="muted">Filter applied to every query: <code>${esc(prov.filter || '')}</code></p>`;
    document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Query copied'), () => toast('Copy failed'));
    }));
  }

  async function verifyLive() {
    const prov = META.provenance || {}, q = prov.queries || {}, counts = prov.group_counts || {};
    const btn = $('btn-verify'); btn.disabled = true; btn.textContent = 'Checking…';
    const rows = [];
    for (const g of Object.keys(q)) {
      try {
        const res = await fetch(apiUrl(q[g]) + '&per_page=1&select=id');
        const j = await res.json();
        const live = j.meta ? j.meta.count : null;
        rows.push([META.labels.taxa[g] || g, counts[g], live]);
      } catch { rows.push([META.labels.taxa[g] || g, counts[g], null]); }
    }
    $('verify-table').innerHTML = `<thead><tr><th>Taxon group</th><th class="num">Snapshot</th><th class="num">Live</th><th class="num">Difference</th></tr></thead><tbody>` +
      rows.map(([g, s, l]) => `<tr><td>${esc(g)}</td><td class="num">${fmt(s)}</td><td class="num">${l == null ? 'error' : fmt(l)}</td>
        <td class="num">${l == null || s == null ? '—' : (l - s >= 0 ? '+' : '') + fmt(l - s)}</td></tr>`).join('') + '</tbody>';
    btn.disabled = false; btn.textContent = 'Verify against OpenAlex now';
  }

  function renderProvenance() {
    const p = META.provenance || {};
    $('provenance').innerHTML = `Snapshot ${esc(META.retrieved_at || '—')} · corpus definition ${esc(p.config_version || '—')} · config MD5 <code>${esc((p.config_md5 || '').slice(0, 10))}</code>`;
  }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 1600);
  }
})();
