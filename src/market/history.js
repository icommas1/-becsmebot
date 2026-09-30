const fs = require("node:fs");
const path = require("node:path");
const DAY_MS = 86400000;
const PRUNE_MS = 60000;

function createPriceHistory({ dataDir, now = Date.now } = {}) {
  const file = dataDir ? path.join(dataDir, "market-history.json") : null;
  let points = {}, lastPruneAt = null;
  if (file && fs.existsSync(file)) {
    try { const saved = JSON.parse(fs.readFileSync(file,"utf8")); if (saved && typeof saved === "object") points = saved; }
    catch (_) { /* Invalid history can be rebuilt from subsequent scans. */ }
  }
  function prune(force = false) {
    const current = now();
    if (!force && lastPruneAt != null && current-lastPruneAt < PRUNE_MS) return;
    lastPruneAt = current;
    const cutoff = current - DAY_MS;
    for (const mint of Object.keys(points)) {
      points[mint] = (Array.isArray(points[mint]) ? points[mint] : [])
        .filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && p[0] >= cutoff && p[0] <= current && Number.isFinite(p[1]) && p[1] > 0)
        .sort((a,b)=>a[0]-b[0])
        .filter((p,index,series)=>index===0||p[0]!==series[index-1][0])
        .slice(-1440);
      if (!points[mint].length) delete points[mint];
    }
    const mints = Object.keys(points).sort((a,b) => points[b].at(-1)[0]-points[a].at(-1)[0]);
    for (const mint of mints.slice(1000)) delete points[mint];
  }
  function sample(rows, at = now()) {
    if(!Number.isInteger(at)||at<0||at>now())return;
    for (const row of rows) {
      if (!Number.isFinite(row.priceUsd) || row.priceUsd <= 0) continue;
      const series = Array.isArray(points[row.mint]) ? points[row.mint] : [];
      if (series.at(-1)?.[0] === at) continue;
      series.push([at,row.priceUsd]); points[row.mint] = series.slice(-1440);
    }
    prune(true);
    if (file) {
      try {
        fs.mkdirSync(dataDir,{recursive:true});
        fs.writeFileSync(file+".tmp",JSON.stringify(points),{mode:0o600});
        fs.renameSync(file+".tmp",file);
      } catch (_) { console.error("Could not persist market chart history"); }
    }
  }
  function snapshot(mints) { prune(); return Object.fromEntries(mints.filter((mint) => points[mint]).map((mint) => [mint,points[mint]])); }
  return { sample, snapshot };
}

module.exports = { createPriceHistory };
