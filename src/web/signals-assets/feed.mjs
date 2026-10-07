const select = document.querySelector('#source');
const status = document.querySelector('#status');
const rows = document.querySelector('#rows');
let busy = false, version = 0;
const money = value => Number.isFinite(value) ? '$' + value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'Unavailable';
async function read(path) { const r = await fetch(path, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw Error(); return r.json(); }
async function refresh() {
  const current = ++version;
  busy = true;
  try {
    const data = await read('/api/signals?source=' + encodeURIComponent(select.value));
    if (current !== version) return;
    status.textContent = `${data.source.provider} · ${data.source.name} · ${data.source.fresh ? 'Reporting' : 'Delayed / unavailable'} · ${data.rows.length} tokens`;
    rows.replaceChildren(...data.rows.map(row => {
      const card = document.createElement('article'); card.className = 'row';
      const info = document.createElement('div'), name = document.createElement('strong'), mint = document.createElement('code'), metrics = document.createElement('p'), mark = document.createElement('span');
      name.textContent = row.symbol + ' · ' + row.name; mint.textContent = row.mint;
      metrics.textContent = `Cap ${money(row.marketCap)} · 24h volume ${money(row.volume24h)} · Liquidity ${money(row.liquidityUsd)}`;
      mark.textContent = row.fresh ? money(row.priceUsd) : 'Delayed'; if (!row.fresh) mark.className = 'delayed';
      info.append(name, mint, metrics); card.append(info, mark); return card;
    }));
    if (!data.rows.length) rows.textContent = 'No observations available for this source.';
  } catch { if (current === version) { status.textContent = 'Signal feed unavailable. Refresh to retry.'; rows.replaceChildren(); } }
  finally { if (current === version) busy = false; }
}
select.addEventListener('change', () => { rows.replaceChildren(); refresh(); });
document.querySelector('#refresh').addEventListener('click', () => refresh());
try {
  const data = await read('/api/signals/sources');
  select.replaceChildren(...data.sources.map(source => { const option = document.createElement('option'); option.value = source.id; option.textContent = source.provider + ' · ' + source.name; return option; }));
  select.value = 'recent'; await refresh();
  setInterval(() => { if (!busy && document.visibilityState === 'visible') refresh(); }, data.pollMs);
} catch { status.textContent = 'Sources unavailable. Reload to retry.'; }
