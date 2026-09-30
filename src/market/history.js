const fs = require("node:fs");
const path = require("node:path");
const DAY_MS = 86400000;
const PRUNE_MS = 60000;
const CHART_POINTS = 120;

function downsample(points, limit = CHART_POINTS) {
  if (points.length <= limit) return points;
  const indexes = new Set([0, points.length - 1]);
  const bucketCount = Math.floor((limit - 2) / 2);
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor(bucket * (points.length - 2) / bucketCount);
    const end = 1 + Math.floor((bucket + 1) * (points.length - 2) / bucketCount);
    let low = start, high = start;
    for (let index = start + 1; index < end; index++) {
      if (points[index][1] < points[low][1]) low = index;
      if (points[index][1] > points[high][1]) high = index;
    }
    indexes.add(low); indexes.add(high);
  }
  return [...indexes].sort((a, b) => a - b).map(index => points[index]);
}

function createPriceHistory({ dataDir, now = Date.now } = {}) {
  const file = dataDir ? path.join(dataDir, "market-history.json") : null;
  let points = {}, lastPruneAt = null, revision = 0;
  if (file && fs.existsSync(file)) {
    try { const saved = JSON.parse(fs.readFileSync(file,"utf8")); if (saved && typeof saved === "object") points = saved; }
    catch (_) { /* Invalid history can be rebuilt from subsequent scans. */ }
  }
  function prune(force = false) {
    const current = now();
    if (!force && lastPruneAt != null && current-lastPruneAt < PRUNE_MS) return;
    lastPruneAt = current;
    const cutoff = current - DAY_MS;
    let changed = false;
    for (const mint of Object.keys(points)) {
      const original=Array.isArray(points[mint])?points[mint]:[];
      const filtered = original
        .filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && p[0] >= cutoff && p[0] <= current && Number.isFinite(p[1]) && p[1] > 0)
        .sort((a,b)=>a[0]-b[0])
        .filter((p,index,series)=>index===0||p[0]!==series[index-1][0])
        .slice(-1440);
      if(original.length!==filtered.length||original.some((point,index)=>!Array.isArray(point)||!filtered[index]||point[0]!==filtered[index][0]||point[1]!==filtered[index][1]))changed=true;
      points[mint]=filtered;
      if (!points[mint].length) { delete points[mint]; changed=true; }
    }
    const mints = Object.keys(points).sort((a,b) => points[b].at(-1)[0]-points[a].at(-1)[0]);
    for (const mint of mints.slice(1000)) { delete points[mint]; changed=true; }
    if(changed)revision++;
  }
  function sample(rows, at = now()) {
    if(!Number.isInteger(at)||at<0||at>now())return;
    let changed = false;
    for (const row of rows) {
      if (!Number.isFinite(row.priceUsd) || row.priceUsd <= 0) continue;
      const series = Array.isArray(points[row.mint]) ? points[row.mint] : [];
      if (series.at(-1)?.[0] === at) continue;
      series.push([at,row.priceUsd]); points[row.mint] = series.slice(-1440); changed = true;
    }
    prune(true);
    if (changed) revision++;
    if (file) {
      try {
        fs.mkdirSync(dataDir,{recursive:true});
        fs.writeFileSync(file+".tmp",JSON.stringify(points),{mode:0o600});
        fs.renameSync(file+".tmp",file);
      } catch (_) { console.error("Could not persist market chart history"); }
    }
  }
  function snapshot(mints) { prune(); return Object.fromEntries(mints.filter((mint) => points[mint]).map((mint) => [mint,points[mint]])); }
  function chartSnapshot(mints, limit = CHART_POINTS) {
    prune();
    return Object.fromEntries(mints.filter(mint => points[mint]).map(mint => [mint, downsample(points[mint], limit)]));
  }
  return { sample, snapshot, chartSnapshot, revision: () => { prune(); return revision; } };
}

module.exports = { createPriceHistory, downsample, CHART_POINTS };
