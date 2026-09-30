function rankSignals(rows,trails) {
  return rows.flatMap(row=>{
    const points=(Array.isArray(trails[row.mint])?trails[row.mint]:[])
      .filter(p=>Array.isArray(p)&&Number.isInteger(p[0])&&p[0]>=0&&p[0]<=Date.now()&&Number.isFinite(p[1])&&p[1]>0)
      .sort((a,b)=>a[0]-b[0]);
    if(!points.length||!Number.isFinite(row.priceUsd)||row.priceUsd<=0||!Number.isFinite(row.observedAt)||row.observedAt> Date.now())return [];
    const first=points[0],latest=points.at(-1);
    return [{...row,firstSeenAt:first[0],observedAt:Math.min(row.observedAt,latest[0]),multiple:row.priceUsd/first[1],peakMultiple:Math.max(...points.map(p=>p[1]))/first[1]}];
  }).sort((a,b)=>b.multiple-a.multiple).slice(0,1000);
}
module.exports={rankSignals};
