import {ageMinutes,num,recentMark} from "./core.mjs";

export const launchDefaults=Object.freeze({
  minLiquidity:2000,minCap:0,maxCap:1000000,minAge:0,maxAge:1440,
  minHolders:0,minOrganicScore:0,minVolume:0
});

export function normalizeRadarUi(stored={}) {
  let ui={tab:"recent",source:"5m",sort:"age",direction:"asc",size:"regular",pageSize:20,...stored};
  if(ui.launchVersion!==2)ui={...ui,tab:"recent",sort:"age",direction:"asc",launchVersion:2};
  if(!["trending","traded","organic","recent"].includes(ui.tab))ui.tab="recent";
  if(!["5m","1h","6h","24h"].includes(ui.source))ui.source="5m";
  return ui;
}

export function paperReady(row,now=Date.now()) {
  return Boolean(num(row?.priceUsd)&&!row.isSus&&recentMark(row.observedAt,180000,now));
}

export function passes(row,settings,now=Date.now()) {
  const age=(now-Date.parse(row.createdAt))/60000;
  if(!paperReady(row,now)||!Number.isFinite(age)||age<0||!num(row.marketCap))return false;
  if(settings.minLiquidity&&(!Number.isFinite(row.liquidityUsd)||row.liquidityUsd<settings.minLiquidity))return false;
  if(settings.minCap&&row.marketCap<settings.minCap)return false;
  if(settings.maxCap&&row.marketCap>settings.maxCap)return false;
  if(settings.minHolders&&(!Number.isFinite(row.holders)||row.holders<settings.minHolders))return false;
  if(settings.minOrganicScore&&(!Number.isFinite(row.organicScore)||row.organicScore<settings.minOrganicScore))return false;
  if(settings.minVolume&&(!Number.isFinite(row.volume5m)||row.volume5m<settings.minVolume))return false;
  if(settings.minAge&&age<settings.minAge||settings.maxAge&&age>settings.maxAge)return false;
  return true;
}

export function selectedFeed(radarUi) {
  return radarUi.tab==="recent"?"recent":radarUi.tab+":"+radarUi.source;
}

export function matchesTopic(row,radarUi) {
  return (row.feeds||[]).includes(selectedFeed(radarUi));
}

export function launchRows(rows,settings,radarUi,now=Date.now()) {
  return rows.filter(row=>passes(row,settings,now)&&matchesTopic(row,radarUi));
}

export function sortValue(row,radarUi,now=Date.now()) {
  const interval=radarUi.source,feed=radarUi.tab+":"+interval;
  switch(radarUi.sort) {
    case "rank":return -(row.ranks?.[radarUi.tab==="recent"?"recent":feed]||999);
    case "change":return row["change"+interval];
    case "volume":return row["volume"+interval];
    case "age":return ageMinutes(row,now);
    default:return row[radarUi.sort];
  }
}
