'use strict';

const App = (() => {
  let scanData = []; // processed series array
  let scanning = false;

  // ── State helpers ──────────────────────────────────────────────────────────
  function showState(name) {
    ['Idle', 'Loading', 'Error', 'Results'].forEach(s => {
      const el = document.getElementById('state' + s);
      if (el) el.style.display = s === name ? (s === 'Results' ? 'block' : 'flex') : 'none';
    });
  }

  function setProgress(pct, title, detail) {
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = Math.min(100, pct) + '%';
    const t = document.getElementById('loadingTitle');
    const d = document.getElementById('loadingDetail');
    if (t && title !== undefined) t.textContent = title;
    if (d && detail !== undefined) d.textContent = detail;
  }

  function setScanBtn(busy) {
    const btn = document.getElementById('scanBtn');
    if (!btn) return;
    btn.disabled = busy;
    btn.innerHTML = busy
      ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Scanning…`
      : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan Library`;
  }

  // ── API calls ──────────────────────────────────────────────────────────────
  async function apiFetch(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── Scan ───────────────────────────────────────────────────────────────────
  async function startScan() {
    if (scanning) return;
    scanning = true;
    scanData = [];
    setScanBtn(true);
    showState('Loading');
    setProgress(0, 'Connecting to Sonarr…', '');

    try {
      const series = await apiFetch('/api/sonarr/series');
      setProgress(5, `Loaded ${series.length} series. Analysing…`, '');

      const results = [];
      for (let i = 0; i < series.length; i++) {
        const s = series[i];
        const pct = 5 + Math.round(((i + 1) / series.length) * 90);
        setProgress(pct, `Analysing: ${s.title}`, `${i + 1} / ${series.length}`);

        let episodes = [], files = [];
        try {
          [episodes, files] = await Promise.all([
            apiFetch(`/api/sonarr/episode?seriesId=${s.id}`),
            apiFetch(`/api/sonarr/episodefile?seriesId=${s.id}`),
          ]);
        } catch (e) {
          console.warn(`Skipping ${s.title}:`, e.message);
          continue;
        }

        // Build file map: fileId → quality name
        const fileMap = {};
        for (const f of files) {
          fileMap[f.id] = f.quality?.quality?.name || 'Unknown';
        }

        // Group episodes by season
        const bySeason = {};
        for (const ep of episodes) {
          const sn = ep.seasonNumber;
          if (!bySeason[sn]) bySeason[sn] = [];
          bySeason[sn].push(ep);
        }

        const seasons = analyseSeasons(bySeason, fileMap);
        const hasProblems = seasons.some(sn => sn.problems.length > 0);

        results.push({ ...s, seasons, hasProblems });
      }

      scanData = results;
      setProgress(100, 'Done!', '');

      buildFilterOptions();
      updateStats();
      showState('Results');
      render();
    } catch (e) {
      document.getElementById('errorMsg').textContent = e.message;
      showState('Error');
    } finally {
      scanning = false;
      setScanBtn(false);
    }
  }

  function reset() {
    scanData = [];
    showState('Idle');
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  function updateStats() {
    const problemSeries = scanData.filter(s => s.hasProblems);
    const totalSeasons  = problemSeries.reduce((acc, s) => acc + s.seasons.filter(sn => sn.problems.length > 0).length, 0);
    const totalEps      = problemSeries.reduce((acc, s) => acc + s.seasons.reduce((a2, sn) => a2 + sn.problems.length, 0), 0);

    document.getElementById('statSeries').textContent   = scanData.length;
    document.getElementById('statSeasons').textContent  = totalSeasons;
    document.getElementById('statEpisodes').textContent = totalEps;
  }

  // ── Filter options ─────────────────────────────────────────────────────────
  function buildFilterOptions() {
    const sel = document.getElementById('filterSeries');
    sel.innerHTML = '<option value="all">All</option>';
    const withProblems = scanData.filter(s => s.hasProblems).sort((a, b) => a.title.localeCompare(b.title));
    for (const s of withProblems) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.title;
      sel.appendChild(opt);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    const filterView   = document.getElementById('filterView').value;
    const filterSeries = document.getElementById('filterSeries').value;
    const filterMinGap = parseInt(document.getElementById('filterMinGap').value, 10);

    let toShow = [...scanData];
    if (filterView === 'problems') toShow = toShow.filter(s => s.hasProblems);
    if (filterSeries !== 'all') toShow = toShow.filter(s => String(s.id) === filterSeries);

    const list = document.getElementById('seriesList');
    const noResults = document.getElementById('noResults');
    list.innerHTML = '';

    if (toShow.length === 0) {
      noResults.style.display = 'flex';
      return;
    }
    noResults.style.display = 'none';

    for (const series of toShow) {
      list.appendChild(buildSeriesBlock(series, filterView, filterMinGap));
    }
  }

  function buildSeriesBlock(series, filterView, minGap) {
    const block = document.createElement('div');
    block.className = 'series-block';

    const problemCount = series.seasons.reduce((a, sn) => a + sn.problems.filter(ep => rankOf(sn.domRank) - rankOf(ep.quality) >= minGap || true).length, 0);

    // Header
    const header = document.createElement('div');
    header.className = 'series-header';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'true');
    header.innerHTML = `
      <div class="series-title-wrap">
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="series-title" title="${escHtml(series.title)}">${escHtml(series.title)}</span>
      </div>
      ${series.hasProblems
        ? `<span class="badge badge-warn">⚠ ${series.seasons.reduce((a,s)=>a+s.problems.length,0)} to upgrade</span>`
        : `<span class="badge badge-ok">✓ All good</span>`
      }
    `;
    header.addEventListener('click', () => {
      block.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', !block.classList.contains('collapsed'));
    });

    // Body
    const body = document.createElement('div');
    body.className = 'series-body';

    const seasonsToRender = filterView === 'problems'
      ? series.seasons.filter(sn => sn.problems.length > 0)
      : series.seasons;

    for (const sn of seasonsToRender) {
      body.appendChild(buildSeasonBlock(sn, minGap));
    }

    block.appendChild(header);
    block.appendChild(body);
    return block;
  }

  function buildSeasonBlock(sn, minGap) {
    const div = document.createElement('div');
    div.className = 'season-block';

    const header = document.createElement('div');
    header.className = 'season-header';
    header.innerHTML = `
      <span class="season-label">Season ${sn.seasonNumber}</span>
      <span class="season-dominant">dominant: <span>${escHtml(sn.dominant || '—')}</span></span>
      ${sn.problems.length > 0
        ? `<span class="badge badge-warn" style="font-size:11px; padding:1px 7px;">${sn.problems.length} episode${sn.problems.length > 1 ? 's' : ''} lower quality</span>`
        : ''}
    `;

    const grid = document.createElement('div');
    grid.className = 'episodes-grid';

    for (const ep of sn.episodes) {
      grid.appendChild(buildEpPill(ep, sn.dominant, sn.domRank, minGap));
    }

    div.appendChild(header);
    div.appendChild(grid);
    return div;
  }

  function buildEpPill(ep, dominant, domRank, minGap) {
    const pill = document.createElement('div');
    const epRank = rankOf(ep.quality);
    const gap = domRank - epRank;

    let cls = 'ep-missing';
    if (ep.hasFile) {
      if (epRank < domRank && gap >= minGap) cls = 'ep-warn';
      else if (epRank === domRank) cls = 'ep-dominant';
      else cls = 'ep-ok';
    }

    pill.className = `ep-pill ${cls}`;
    pill.setAttribute('title', '');

    const qualShort = ep.quality ? shortOf(ep.quality) : '—';
    const tooltipText = ep.hasFile
      ? `E${String(ep.episodeNumber).padStart(2,'0')}: ${ep.title || ''}\n${ep.quality || '—'}`
      : `E${String(ep.episodeNumber).padStart(2,'0')}: ${ep.title || ''}\nNo file`;

    pill.innerHTML = `
      <span class="ep-num">E${String(ep.episodeNumber).padStart(2, '0')}</span>
      <span class="ep-qual">${escHtml(qualShort)}</span>
      <span class="ep-tooltip">${escHtml(tooltipText.replace('\n', ' — '))}</span>
    `;

    return pill;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { startScan, reset, render };
})();
