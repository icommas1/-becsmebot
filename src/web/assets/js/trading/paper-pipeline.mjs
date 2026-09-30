import {decideBuy,decideSale} from "./decision-engine.mjs";
import {createPaperExecutor} from "./paper-executor.mjs";

function executeDecision(paper,decision,market) {
  if(!decision.intents.length)return {ok:false,message:decision.message};
  const execution=createPaperExecutor({account:paper.account,paper}).execute(decision.intents[0],market);
  const result={ok:execution.status==="filled",message:execution.message,execution};
  if(result.ok&&decision.intents[0].side==="buy") {
    const row=market.row;
    result.priceRecord={priceUsd:Number(row.priceUsd),source:"tokens",marketCap:row.marketCap,liquidityUsd:row.liquidityUsd};
  } else if(result.ok) {
    result.gross=execution.filledQuoteQuantity;
    result.remaining=paper.holds[decision.intents[0].asset]?.qty||0;
  }
  return result;
}

// Thin browser-ledger adapters; strategy and execution receive separate inputs.
export function buyPaper({paper,row,amount,automatic=false,solRate,feed,now=Date.now()}) {
  const decision=decideBuy({account:paper.account,row,amount,automatic,solRate,feed,
    settings:paper.settings,enteredAssets:paper.bought,now});
  return executeDecision(paper,decision,{row,solRate,now});
}

export function sellPaper({paper,mint,pct,dollars=null,automatic=false,solRate,mark,markAt,marketCap=null,now=Date.now()}) {
  const decision=decideSale({account:paper.account,positions:paper.holds,mint,pct,dollars,automatic,now});
  return executeDecision(paper,decision,{solRate,mark,markAt,marketCap,now});
}
