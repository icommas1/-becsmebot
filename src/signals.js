function rankSignals(rows,trails) {
  return rows.flatMap(row=>{
    const points=trails[row.mint];
    if(!points?.length||!Number.isFinite(row.priceUsd)||row.priceUsd<=0)return [];
    const first=points[0],latest=points.at(-1);
    return [{...row,firstSeenAt:first[0],observedAt:Math.min(row.observedAt,latest[0]),multiple:row.priceUsd/first[1],peakMultiple:Math.max(...points.map(p=>p[1]))/first[1]}];
  }).sort((a,b)=>b.multiple-a.multiple).slice(0,100);
}
module.exports={rankSignals};
