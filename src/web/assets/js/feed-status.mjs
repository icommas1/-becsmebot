const DEX_LABELS={
  "dex:profiles":"Dex profiles","dex:updates":"Dex updates","dex:takeovers":"Dex takeovers",
  "dex:ads":"Dex paid ads","dex:boosts":"Dex latest boosts (paid)","dex:top":"Dex top boosts (paid)"
};
const JUPITER_LABELS={trending:"Trending",traded:"Active",organic:"Organic"};

function label(name) {
  if(name==="recent")return "New launches";
  if(DEX_LABELS[name])return DEX_LABELS[name];
  const [topic,interval]=name.split(":");
  return JUPITER_LABELS[topic]&&/^(5m|1h|6h|24h)$/.test(interval)?JUPITER_LABELS[topic]+" · "+interval:name;
}

function lastSuccess(at,now) {
  if(!at)return "No successful scan yet";
  const elapsed=now-Date.parse(at);
  if(!Number.isFinite(elapsed)||elapsed<0)return "Scan time unavailable";
  if(elapsed<60000)return "Updated just now";
  const minutes=Math.floor(elapsed/60000);
  return minutes<60?"Updated "+minutes+"m ago":"Updated "+Math.floor(minutes/60)+"h ago";
}

export function feedStatus(feeds={},now=Date.now()) {
  const rows=Object.entries(feeds).map(([name,feed])=>{
    const updated=lastSuccess(feed?.at,now);
    const age=now-Date.parse(feed?.at);
    const valid=Number.isFinite(age)&&age>=0;
    // Match the operational five-minute feed freshness used by production smoke.
    const state=feed?.error||valid&&age>300000?"Delayed":valid?"Reporting":"Pending";
    const count=Number.isInteger(feed?.count)&&feed.count>=0?feed.count:0;
    return {name,label:label(name),state,
      text:label(name)+" · "+count+(state==="Delayed"?" cached":"")+(count===1?" token":" tokens")+" · "+state+" · "+updated+(feed?.error?" · "+feed.error:"")};
  });
  const reporting=rows.filter(row=>row.state==="Reporting").length;
  const delayed=rows.filter(row=>row.state==="Delayed").length;
  return {rows,summary:reporting+"/"+rows.length+" reporting · "+delayed+" delayed · "+(rows.length-reporting-delayed)+" pending"};
}
