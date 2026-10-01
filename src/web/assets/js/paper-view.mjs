import {ageText,compactUsd,num,recentMark,short,signalState,stateIcon,tokenPrice,usd} from "./core.mjs";
import {paperReady,passes} from "./filters.mjs";
import {portfolioSummary} from "./paper-wallet.mjs";
import {node,sparkline} from "./dom.mjs";

export function createPaperView({document,getState,actions}) {
  const $=id=>document.getElementById(id);
  const chart=(mint,trail)=>sparkline(document,trail.points[mint]||[]);
  const stateFor=(row,paper)=>signalState(row,paper.holds);

  function infoLinks(box,mint) {
    box.append(node(document,"small","mono",mint));
    const buttons=node(document,"div","actionbar"),copy=node(document,"button","secondary","Copy CA"),link=node(document,"a","link","Dex Screener");
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(mint);actions.message("Token address copied.");}catch(_error){actions.message("Copy this address: "+mint);}};
    link.href="https://dexscreener.com/solana/"+mint;link.target="_blank";link.rel="noopener noreferrer";buttons.append(copy,link);box.append(buttons);
  }

  function renderWallet() {
    const {paper,prices,priceTimes}=getState(),{holds,value,pnl,estimated}=portfolioSummary(paper,prices,priceTimes),rate=actions.solUsd();
    $("hud-cash").textContent="CASH "+short(paper.cashSol)+" SOL";$("hud-pnl").textContent="P/L "+usd(pnl);
    $("cash").textContent=short(paper.cashSol)+" SOL";$("open-value").textContent=usd(value)+(estimated?" · estimated":"");
    $("profit").textContent=usd(pnl);$("profit").className=pnl>=0?"good":"bad";$("hold-count").textContent=String(holds.length);
    $("sol-rate").textContent=rate?"SOL "+usd(rate):"SOL price pending";$("auto").textContent=paper.auto?"Stop auto paper":"Start auto paper";
    $("auto-label").textContent="Auto paper: "+(paper.auto?"on":"off");$("auto-label").className="pill "+(paper.auto?"paper":"");
  }

  function renderHolds() {
    const {paper,prices,priceTimes}=getState(),box=$("paper-holds");box.replaceChildren();const holds=Object.values(paper.holds);
    for(const hold of holds) {
      const mark=num(prices[hold.mint]?.priceUsd)||num(hold.lastPrice),value=hold.qty*(mark||0),pnl=value-hold.investedUsd-hold.feesUsd;
      const row=node(document,"div","item");row.append(node(document,"div","name",hold.symbol+" · "+short(hold.qty)+" tokens"));
      row.append(node(document,"div","meta","Entry "+tokenPrice(hold.entryPrice)+" · now "+tokenPrice(mark)+" · entry cap "+usd(hold.entryCap)+" · now cap "+usd(prices[hold.mint]?.marketCap)+" · liquidity "+usd(prices[hold.mint]?.liquidityUsd)));
      row.append(node(document,"div",pnl>=0?"good":"bad","Value "+usd(value)+" · P/L "+usd(pnl)+" ("+(hold.investedUsd?short(pnl/(hold.investedUsd+hold.feesUsd)*100):"—")+"%)"));
      if(!recentMark(priceTimes[hold.mint],120000))row.append(node(document,"small","bad","Price may be stale"));
      const buttons=node(document,"div","actionbar");
      for(const [label,amount] of [["Sell $1",1],["Sell all",null]]){const button=node(document,"button","secondary",label);button.onclick=()=>actions.sell(hold.mint,100,amount);buttons.append(button);}
      row.append(buttons);infoLinks(row,hold.mint);box.append(row);
    }
    if(!holds.length)box.append(node(document,"p","","No paper holds yet."));
    const activity=$("activity");activity.replaceChildren();
    for(const entry of paper.activity.slice(0,100))activity.append(node(document,"div","item",new Date(entry.at).toLocaleString()+" · "+entry.text));
    if(!paper.activity.length)activity.append(node(document,"p","","No paper activity yet."));
  }

  function renderDock() {
    const state=getState(),{paper,dockAmount,trail}=state,row=actions.currentToken(),context=$("execution-context");context.replaceChildren();
    if(row){const signal=stateFor(row,paper);context.append(node(document,"div","contact-head",row.symbol+" / "+stateIcon(signal)+" "+signal),
      node(document,"p","contact-meta",ageText(row)+" · "+(row.launchpad||"Jupiter")+" · "+(row.isVerified?"Verified":"Unverified")),
      node(document,"p","",tokenPrice(row.priceUsd)),node(document,"p","contact-meta","MC "+compactUsd(row.marketCap)+" · LIQ "+compactUsd(row.liquidityUsd)+" · VOL "+compactUsd(row.volume5m)),chart(row.mint,trail));infoLinks(context,row.mint);}
    else context.append(node(document,"p","micro-note","Select a blip or token. The paper execution dock follows your selection."));
    $("dock-token").textContent=row?row.symbol+" · "+compactUsd(row.marketCap):"SELECT TOKEN";
    $("dock-buy").textContent="BUY $"+short(dockAmount);$("dock-sell").textContent="SELL $"+short(dockAmount);
    $("dock-buy").disabled=!row||!passes(row,paper.settings)||!!paper.bought[row.mint]||!actions.solUsd();$("dock-sell").disabled=!row||!actions.canSell(row.mint);
    $("dock-status").textContent=!row?"Select a launch · real trading off":!paperReady(row)?"Price stale · paper buy unavailable":paper.bought[row.mint]?"Bought once · sells need fresh V3 marks":"Simulated fill · fee extra";
    for(const button of $("dock-sizes").children)button.className=Number(button.dataset.amount)===dockAmount?"selected":"";
    if($("token-sheet").open)renderSheet();
  }

  function renderSheet() {
    const {paper,dockAmount,trail}=getState(),row=actions.currentToken();if(!row)return;
    const sheet=$("token-sheet"),scrollTop=sheet.scrollTop;
    const signal=stateFor(row,paper);$("sheet-title").textContent=row.symbol+" / "+stateIcon(signal)+" "+signal;
    const box=$("sheet-content");box.replaceChildren();box.append(node(document,"p","",row.name||row.symbol),
      node(document,"p","contact-meta",ageText(row)+" · "+(row.launchpad||"Jupiter")+" · "+(row.isVerified?"Verified":"Unverified")),
      node(document,"p","",tokenPrice(row.priceUsd)+" · MC "+compactUsd(row.marketCap)+" · liquidity "+compactUsd(row.liquidityUsd)),chart(row.mint,trail),
      node(document,"p","micro-note","Momentum uses observed 5m change. Activity bars use organic score, volume and momentum; wallet scoring is unavailable. Unverified does not mean safe."),
      node(document,"p","micro-note","Feeds: "+(row.feeds||[]).join(" / ")));infoLinks(box,row.mint);
    $("sheet-buy").disabled=$("dock-buy").disabled;$("sheet-sell").disabled=$("dock-sell").disabled;
    $("sheet-buy").textContent="Paper buy $"+short(dockAmount);$("sheet-sell").textContent="Paper sell $"+short(dockAmount);
    sheet.scrollTop=scrollTop;
  }

  function renderTape() {
    const {contactTape,paper}=getState(),tape=$("trade-tape");tape.replaceChildren();
    const entries=[...contactTape,...paper.activity.slice(0,20)].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,30);
    for(const entry of entries)tape.append(node(document,"span","tape-entry",new Date(entry.at).toLocaleTimeString()+" / "+entry.text+(entry.source?" · MC "+compactUsd(entry.marketCap)+" · "+entry.source:"")));
    if(!entries.length)tape.append(node(document,"span","tape-entry","Awaiting detections · Jupiter REST scans every 60s · paper activity only"));
  }

  return Object.freeze({renderWallet,renderHolds,renderDock,renderSheet,renderTape});
}

