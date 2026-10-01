import {ageMinutes,ageText,compactUsd,short,signalState,signalStrength,stateIcon,tokenPrice,usd} from "./core.mjs";
import {matchesTopic,passes,selectedFeed,sortValue,launchRows} from "./filters.mjs";
import {node,sparkline,strengthBars} from "./dom.mjs";
import {feedStatus} from "./feed-status.mjs";

export function createRadarView({document,getState,actions}) {
  const $=id=>document.getElementById(id);
  const chart=(mint,trail)=>sparkline(document,trail.points[mint]||[]);
  const stateFor=(row,paper)=>signalState(row,paper.holds);

  function renderFilterSummary() {
    const {paper}=getState(),settings=paper.settings;
    $("filter-summary").textContent=(settings.maxAge?"≤"+short(settings.maxAge/60)+"h":"Any age")+
      " · MC "+(settings.maxCap?"≤"+usd(settings.maxCap):"any")+" · liquidity ≥"+usd(settings.minLiquidity);
  }

  let radarContext=null;

  function tokenCard(row) {
    const {paper,prices,priceTimes,radarUi,selectedMint,trail}=getState();
    const card=node(document,"article","token-contact"+(selectedMint===row.mint?" selected":""));
    card.dataset.mint=row.mint;
    const state=stateFor(row,paper),head=node(document,"div","contact-head");
    const select=node(document,"button","contact-select",row.symbol);select.type="button";select.onclick=()=>actions.selectToken(row);
    head.append(select,node(document,"span","state state-"+state.toLowerCase(),stateIcon(state)+" "+state),strengthBars(document,row));card.append(head);
    card.append(node(document,"div","contact-meta",ageText(row)+" · "+(row.launchpad||(radarUi.tab.startsWith("dex:")?"DexScreener · Jupiter metrics":"Jupiter"))+" · "+(row.isVerified?"Verified":"Unverified")));
    const stats=node(document,"div","contact-stats");
    for(const [label,value] of [["MC",compactUsd(row.marketCap)],["LIQ",compactUsd(row.liquidityUsd)],
      ["VOL "+radarUi.source,compactUsd(row["volume"+radarUi.source])],["ORGANIC",row.organicScore==null?"—":short(row.organicScore)+"/100"]]) {
      const cell=node(document,"span");cell.append(node(document,"small","",label),node(document,"b","",value));stats.append(cell);
    }
    card.append(stats);
    const bottom=node(document,"div","contact-bottom");bottom.append(node(document,"span","",tokenPrice(row.priceUsd)),chart(row.mint,trail));card.append(bottom);
    const buttons=node(document,"div","actionbar"),buy=node(document,"button","",paper.bought[row.mint]?"BOUGHT":"BUY $1");
    const sell=node(document,"button","secondary","SELL $1"),inspect=node(document,"button","secondary","DETAILS");
    buy.disabled=!passes(row,paper.settings)||!!paper.bought[row.mint]||!actions.solUsd();
    buy.onclick=()=>{actions.selectTokenState(row);actions.buy(row,false,1);actions.refreshPrices(true);};
    sell.disabled=!actions.canSell(row.mint,prices,priceTimes);sell.onclick=()=>actions.sell(row.mint,100,1);
    inspect.onclick=()=>actions.selectToken(row);buttons.append(buy,sell,inspect);card.append(buttons);
    return card;
  }

  function renderInstrument(rows) {
    const {paper}=getState(),box=$("radar-map");box.replaceChildren();
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 600 300");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("aria-hidden","true");
    const add=(tag,attrs)=>{const element=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));svg.append(element);return element;};
    for(const radius of [48,88,128])add("ellipse",{cx:300,cy:150,rx:radius*1.7,ry:radius,fill:"none",stroke:"#1e4144","stroke-width":1});
    add("line",{x1:65,y1:150,x2:535,y2:150,stroke:"#1e4144"});add("line",{x1:300,y1:15,x2:300,y2:285,stroke:"#1e4144"});add("circle",{cx:300,cy:150,r:4,fill:"#b8fa52"});box.append(svg);
    for(const row of rows) {
      let hash=0;for(const character of row.mint)hash=(hash*31+character.charCodeAt(0))>>>0;
      const angle=(hash%360)*Math.PI/180,age=ageMinutes(row)||0,radius=45+(hash%18)+Math.min(1,age/(paper.settings.maxAge||1440))*65;
      const state=stateFor(row,paper),dot=node(document,"button","radar-blip state-"+state.toLowerCase());dot.type="button";
      dot.style.left=(50+Math.cos(angle)*radius*1.7/6)+"%";dot.style.top=(50+Math.sin(angle)*radius/3)+"%";
      dot.style.setProperty("--blip",8+signalStrength(row)*2+"px");
      dot.setAttribute("aria-label",row.symbol+" "+state+" "+ageText(row)+" market cap "+compactUsd(row.marketCap));
      dot.title=row.symbol+" · "+state;dot.onclick=()=>actions.selectToken(row);dot.append(node(document,"span","",row.symbol.slice(0,10)));box.append(dot);
    }
    box.append(rows.length?node(document,"span","radar-total",rows.length+" CONTACTS"):node(document,"div","radar-empty","WAITING FOR ELIGIBLE CONTACTS"));
  }

  function renderRadar() {
    const state=getState(),{paper,radarUi,snapshot,searchRows,searchStatus}=state,box=$("radar");
    const panel=box.closest(".radar-panel"),panelTop=panel.scrollTop;
    const bounds=box.getBoundingClientRect(),left=bounds.left,scrollLeft=box.scrollLeft;
    const visible=[...box.children].reduce((best,card)=>{
      if(!card.dataset.mint)return best;
      const rect=card.getBoundingClientRect();
      const width=Math.min(rect.right,bounds.right)-Math.max(rect.left,bounds.left);
      return width>(best?.width||0)?{card,width,left:rect.left}:best;
    },null);
    const anchor=visible?{mint:visible.card.dataset.mint,offset:visible.left-left}:null;
    const query=$("radar-search").value.trim().toLowerCase(),feed=selectedFeed(radarUi);
    const allRows=query?[...new Map([...(snapshot?.radar||[]),...searchRows].map(row=>[row.mint,row])).values()]:(snapshot?.radar||[]);
    const candidates=allRows.filter(row=>query?(row.symbol.toLowerCase().includes(query)||row.name.toLowerCase().includes(query)||row.mint.toLowerCase().includes(query)):matchesTopic(row,radarUi));
    const rows=candidates.filter(row=>passes(row,paper.settings));
    rows.sort((a,b)=>{const x=sortValue(a,radarUi),y=sortValue(b,radarUi);if(x==null)return y==null?0:1;if(y==null)return -1;return (x-y)*(radarUi.direction==="desc"?-1:1);});
    const size=[10,20,50].includes(Number(radarUi.pageSize))?Number(radarUi.pageSize):20;
    const pages=Math.max(1,Math.ceil(rows.length/size)),page=Math.min(state.radarPage,pages-1);actions.setRadarPage(page);
    const context=JSON.stringify([feed,query,radarUi.sort,radarUi.direction,radarUi.source,size,page,paper.settings]);
    const keepPosition=context===radarContext;
    radarContext=context;
    box.replaceChildren();
    const feedInfo=snapshot?.feeds?.[feed];
    $("radar-count").textContent=rows.length+" matches · "+(candidates.length-rows.length)+" filtered out"+(feedInfo?.error?" · feed delayed":"");
    $("page-label").textContent="Page "+(page+1)+" of "+pages;$("previous").disabled=page===0;$("next").disabled=page>=pages-1;
    for(const row of rows.slice(page*size,(page+1)*size))box.append(tokenCard(row));
    if(!rows.length)box.append(node(document,"p","empty-state",query&&(searchStatus==="Searching Jupiter…"||searchStatus.startsWith("Search:"))?searchStatus:feedInfo?.error?"Feed delayed: "+feedInfo.error:"No fresh launches match these filters. Adjust Launch filters above."));
    // Removing every card resets horizontal scroll in WebKit. Restore the visible
    // mint after a refresh, even if fresh launches changed its position in the list.
    const sameCard=keepPosition&&anchor?[...box.children].find(card=>card.dataset.mint===anchor.mint):null;
    box.scrollLeft=keepPosition?(sameCard?box.scrollLeft+sameCard.getBoundingClientRect().left-left-anchor.offset:scrollLeft):0;
    renderInstrument(rows.slice(0,40));
    panel.scrollTop=panelTop;
    $("radar-source").disabled=radarUi.tab.startsWith("dex:");
    for(const button of $("radar-tabs").children){button.className=button.dataset.tab===radarUi.tab?"selected":"";button.setAttribute("aria-pressed",String(button.dataset.tab===radarUi.tab));}
    $("sort-direction").textContent=radarUi.sort==="age"?(radarUi.direction==="asc"?"Newest first":"Oldest first"):(radarUi.direction==="desc"?"Highest first ↓":"Lowest first ↑");
  }

  function renderSignals() {
    const {paper,radarUi,snapshot,trail}=getState(),box=$("signals");box.replaceChildren();
    $("signal-scope").textContent=selectedFeed(radarUi)+" / launch filters";
    for(const signal of launchRows(snapshot?.signals||[],paper.settings,radarUi).slice(0,100)) {
      const item=node(document,"button","rail-contact");item.type="button";item.onclick=()=>actions.selectToken(signal);
      const state=stateFor(signal,paper);item.append(node(document,"span","state state-"+state.toLowerCase(),stateIcon(state)+" "+state),
        node(document,"strong","",signal.symbol),node(document,"span","rail-multiple",short(signal.multiple)+"×"),
        node(document,"small","",ageText(signal)+" · MC "+compactUsd(signal.marketCap)),chart(signal.mint,trail));box.append(item);
    }
    if(!box.children.length)box.append(node(document,"p","empty-state","No launches match this source and filters."));
    const feeds=$("feeds"),status=feedStatus(snapshot?.feeds||{});feeds.replaceChildren();
    $("feed-summary").textContent=status.summary;
    for(const row of status.rows)feeds.append(node(document,"div","item feed-item feed-"+row.state.toLowerCase(),row.text));
  }

  return Object.freeze({renderFilterSummary,renderRadar,renderSignals});
}
