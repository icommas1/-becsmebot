export function num(value) {
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}

export function recentMark(at,maxAge,now=Date.now()) {
  const age=now-at;
  return Number.isFinite(at)&&at>0&&age>=0&&age<=maxAge;
}

export function usd(value) {
  return Number.isFinite(value)?"$"+value.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}):"—";
}

export function tokenPrice(value) {
  return Number.isFinite(value)&&value>0?"$"+value.toLocaleString(undefined,{maximumSignificantDigits:6}):"—";
}

export function short(value) {
  return Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:5}):"—";
}

export function compactUsd(value) {
  return Number.isFinite(value)?"$"+Intl.NumberFormat(undefined,{notation:"compact",maximumFractionDigits:1}).format(value):"—";
}

export function ageMinutes(row,now=Date.now()) {
  const time=Date.parse(row.createdAt);
  return Number.isFinite(time)?Math.max(0,(now-time)/60000):null;
}

export function ageText(row,now=Date.now()) {
  const age=ageMinutes(row,now);
  return age==null?"age —":age<60?Math.floor(age)+"m":age<1440?Math.floor(age/60)+"h":Math.floor(age/1440)+"d";
}

export function signalState(row,holds={},now=Date.now()) {
  if(holds[row.mint]?.autoExited)return "EXIT";
  const change=row.change5m;
  if(Number.isFinite(change)&&change<0)return "COOLING";
  if(Number.isFinite(change)&&change>=5)return "HEATING";
  if(ageMinutes(row,now)!=null&&ageMinutes(row,now)<5)return "NEW";
  return (row.feeds||[]).some(feed=>feed.startsWith("trending:"))||change>0?"TRENDING":"NEW";
}

export function stateIcon(state) {
  return {NEW:"◇",HEATING:"↗",TRENDING:"◆",COOLING:"↘",EXIT:"⊗"}[state];
}

export function signalStrength(row) {
  const organic=Number.isFinite(row.organicScore)?row.organicScore:0;
  const change=Number.isFinite(row.change5m)?Math.max(0,row.change5m):0;
  const volume=Number.isFinite(row.volume5m)?row.volume5m:0;
  return Math.min(5,Math.max(1,Math.ceil((organic+Math.min(30,change)+Math.min(30,Math.log10(volume+1)*6))/25)));
}
