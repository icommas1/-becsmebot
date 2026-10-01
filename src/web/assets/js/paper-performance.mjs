import {node} from "./dom.mjs";
import {compactUsd,usd} from "./core.mjs";

// Each row is one simulated sale, including partial exits. Older activity has no
// cost basis and cannot be retroactively turned into a return observation.
export function recordedSales(activity,source="all") {
  return (Array.isArray(activity)?activity:[]).filter(entry=>
    entry?.kind==="sell" && Number.isFinite(entry.basisUsd) && entry.basisUsd>0 &&
    Number.isFinite(entry.netUsd) && entry.netUsd>=0 &&
    Number.isFinite(entry.realizedUsd) &&
    (source==="all" || (source==="auto"?entry.source==="auto target":entry.source==="manual"))
  ).map(entry=>({...entry,returnPct:entry.realizedUsd/entry.basisUsd*100}));
}

export function saleSummary(sales) {
  if(!sales.length)return {count:0,realized:0,winRate:null,medianReturn:null};
  const returns=sales.map(sale=>sale.returnPct).sort((a,b)=>a-b),mid=Math.floor(returns.length/2);
  return {count:sales.length,realized:sales.reduce((sum,sale)=>sum+sale.realizedUsd,0),
    winRate:sales.filter(sale=>sale.realizedUsd>0).length/sales.length*100,
    medianReturn:returns.length%2?returns[mid]:(returns[mid-1]+returns[mid])/2};
}

function chart(document,sales) {
  const plotted=sales.filter(sale=>Number.isFinite(sale.entryCap)&&sale.entryCap>0);
  const wrap=node(document,"div","performance-chart");
  if(!plotted.length){wrap.append(node(document,"p","empty-state","No recorded sales with an entry market cap yet."));return wrap;}
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 800 290");svg.setAttribute("role","img");
  svg.setAttribute("aria-label",`${plotted.length} paper sales plotted by entry market cap and net return`);
  const caps=plotted.map(sale=>Math.log10(sale.entryCap)),returns=plotted.map(sale=>sale.returnPct);
  const minX=Math.min(...caps),maxX=Math.max(...caps),minY=Math.min(0,...returns),maxY=Math.max(0,...returns);
  const x=(cap)=>70+(Math.log10(cap)-minX)/(maxX-minX||1)*690;
  const y=(ret)=>240-(ret-minY)/(maxY-minY||1)*200;
  const line=(x1,y1,x2,y2)=>{const el=document.createElementNS(ns,"line");
    for(const [key,value] of Object.entries({x1,y1,x2,y2}))el.setAttribute(key,String(value));svg.append(el);};
  const label=(value,xPos,yPos)=>{const el=document.createElementNS(ns,"text");el.setAttribute("x",String(xPos));
    el.setAttribute("y",String(yPos));el.textContent=value;svg.append(el);};
  line(70,20,70,240);line(70,240,760,240);
  if(minY<0&&maxY>0)line(70,y(0),760,y(0));
  label(`${maxY.toFixed(0)}%`,10,25);label(`${minY.toFixed(0)}%`,10,243);
  label(compactUsd(10**minX),70,268);label(compactUsd(10**maxX),700,268);
  for(const sale of plotted){const dot=document.createElementNS(ns,"circle");
    dot.setAttribute("cx",String(x(sale.entryCap)));dot.setAttribute("cy",String(y(sale.returnPct)));
    dot.setAttribute("r","5");dot.setAttribute("class",sale.realizedUsd>0?"sale-positive":"sale-negative");
    const title=document.createElementNS(ns,"title");title.textContent=`${sale.symbol||"Token"}: ${sale.returnPct.toFixed(1)}% at ${usd(sale.entryCap)} entry cap`;
    dot.append(title);svg.append(dot);}
  wrap.append(svg);return wrap;
}

export function createPerformanceView({document,getPaper}) {
  const $=id=>document.getElementById(id);
  function render() {
    const paper=getPaper(),source=$("performance-source").value,sales=recordedSales(paper.activity,source),summary=saleSummary(sales);
    $("performance-count").textContent=String(summary.count);
    $("performance-realized").textContent=usd(summary.realized);
    $("performance-realized").className=summary.realized>=0?"good":"bad";
    $("performance-winrate").textContent=summary.winRate==null?"—":summary.winRate.toFixed(0)+"%";
    $("performance-median").textContent=summary.medianReturn==null?"—":summary.medianReturn.toFixed(1)+"%";
    $("performance-ledger-total").textContent=usd(paper.realizedUsd);
    const chartBox=$("performance-chart"),list=$("performance-sales");
    chartBox.replaceChildren(chart(document,sales));list.replaceChildren();
    for(const sale of sales.slice(0,100)) {
      const row=node(document,"div","performance-sale item");
      row.append(node(document,"div","name",(sale.symbol||"Token")+" · "+(sale.source==="auto target"?"Auto paper":"Manual paper")),
        node(document,"div","meta",`${new Date(sale.at).toLocaleString()} · Entry cap ${usd(sale.entryCap)} · Basis ${usd(sale.basisUsd)} · Net proceeds ${usd(sale.netUsd)}`),
        node(document,"div",sale.realizedUsd>=0?"good":"bad",`${sale.returnPct.toFixed(1)}% · ${usd(sale.realizedUsd)} realized`));
      list.append(row);
    }
    if(!sales.length)list.append(node(document,"p","empty-state","No recorded paper sales for this selection. New simulated sales will appear here."));
  }
  $("performance-source").addEventListener("change",render);
  return {render};
}
