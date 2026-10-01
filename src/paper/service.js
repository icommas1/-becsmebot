const {isValid}=require("../api/validation");
const {hash,fault}=require("./store");
const {limits}=require("./config");
const {createEventDraft}=require("../events/becs-event");

function canonical(value){return value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
const safeJson=value=>JSON.parse(JSON.stringify(value));
const modules=Promise.all([
  import("../web/assets/js/trading/decision-engine.mjs"),import("../web/assets/js/trading/contracts.mjs"),
  import("../web/assets/js/trading/paper-executor.mjs"),import("../web/assets/js/paper-wallet.mjs"),import("../web/assets/js/core.mjs")
]);

function commandEvent({type,input,paper,payload,strategy=null,occurredAt=input.createdAt}){
  return createEventDraft({type,source:"paper-service",payload:safeJson(payload),occurredAt,requestId:input.requestId,
    accountId:paper.account.accountId,strategy});
}

function createPaperService({store,market}) {
  async function command(userId,input) {
    if(!isValid("paperCommand",input))throw fault(400,"Invalid paper request.");
    const [decisions,contracts,execution,wallet,core]=await modules;
    return store.command(userId,input,hash(JSON.stringify(canonical(input))),async paper=>{
      if(paper.account.userId!==userId||paper.account.executionMode!=="paper")throw fault(403,"Paper account is unavailable.");
      if(input.type==="settings"){
        const before=safeJson(paper.settings),settings={...paper.settings,...input.settings};
        if(settings.maxCap&&settings.minCap>settings.maxCap||settings.maxAge&&settings.minAge>settings.maxAge)
          throw fault(400,"Minimum cannot exceed maximum.");
        paper.settings=settings;
        return {ok:true,message:"Shared settings saved.",auditEvents:[commandEvent({type:"paper.settings.updated",input,paper,
          payload:{before,after:settings}})]};
      }
      if(input.type==="cash"){
        const before=paper.cashSol;paper.cashSol=input.cashSol;execution.recordActivity(paper,"adjust","Set paper cash to "+input.cashSol+" SOL");
        return {ok:true,message:"Paper cash updated.",auditEvents:[commandEvent({type:"paper.cash.adjusted",input,paper,
          payload:{beforeCashSol:before,afterCashSol:input.cashSol}})]};
      }
      if(input.type==="reset"){
        const account=paper.account,settings=paper.settings,before={cashSol:paper.cashSol,positions:Object.keys(paper.holds||{}).length,
          activityEntries:Array.isArray(paper.activity)?paper.activity.length:0};
        Object.assign(paper,wallet.freshPaper(),{account,settings,cashSol:input.cashSol});
        return {ok:true,message:"Paper wallet reset.",auditEvents:[commandEvent({type:"paper.wallet.reset",input,paper,
          payload:{before,after:{cashSol:input.cashSol,positions:0,activityEntries:0}}})]};
      }
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault(503,"Paper market data timed out. Retry the same action.")),limits.marketTimeoutMs);});
      // Fetch under the account lock, after duplicate detection; retries need no quote.
      const data=await Promise.race([(async()=>{
        const snapshot=market.terminalSnapshot?market.terminalSnapshot():market.snapshot();
        let row=snapshot.radar.find(r=>r.mint===input.mint);
        if(input.type==="buy"&&!row&&!input.automatic)row=(await market.search(input.mint)).find(r=>r.mint===input.mint);
        const mark=input.type==="sell"?(await market.paperPrices([input.mint]))[input.mint]:null;
        return {snapshot,row,mark};
      })(),timeout]).finally(()=>clearTimeout(timer));
      const {snapshot,row,mark}=data,now=Date.now();
      const solRate=core.recentMark(snapshot.solPriceAt,180000,now)?snapshot.solUsd:null;
      let decision;
      if(input.type==="buy"){
        if(!row||input.automatic&&!row.feeds.includes(input.feed))return {ok:false,message:"This token is outside the selected source."};
        // Auto amount is account configuration, never caller-controlled strategy.
        if(input.automatic&&input.amount!==paper.settings.betUsd)throw fault(409,"Auto amount changed. Refresh the account.");
        decision=decisions.decideBuy({account:paper.account,row,amount:input.amount,automatic:input.automatic,
          feed:input.feed,settings:paper.settings,enteredAssets:paper.bought,now});
      }else{
        if(input.automatic&&(input.dollars!==1||!decisions.autoExitCandidates({enabled:true,positions:paper.holds,
          settings:paper.settings,prices:{[input.mint]:mark}}).some(h=>h.mint===input.mint)))
          return {ok:false,message:"Paper target exit is not eligible."};
        decision=decisions.decideSale({account:paper.account,positions:paper.holds,mint:input.mint,pct:100,dollars:input.dollars,automatic:input.automatic,now});
      }
      if(!decision.intents.length)return {ok:false,message:decision.message};
      const request=decision.intents[0];
      const intent=contracts.createOrderIntent({account:paper.account,strategy:request.strategy,asset:request.asset,side:request.side,
        quantity:request.quantity,...request.context,now:Date.parse(input.createdAt),intentId:input.requestId});
      const marketContext={now,row,solRate,mark:mark?{...mark,source:"jupiter-v3"}:null,markAt:mark?.observedAt,marketCap:row?.marketCap??null};
      const result=execution.createPaperExecutor({account:paper.account,paper}).execute(intent,marketContext);
      const {userId:_intentUser,...intentPayload}=intent,{userId:_resultUser,...resultPayload}=result;
      const evidence={row:row??null,solUsd:snapshot.solUsd??null,solPriceAt:snapshot.solPriceAt??null,mark:marketContext.mark,
        settings:paper.settings,decision:{side:intent.side,reason:intent.context.reason,source:intent.context.source,automatic:intent.context.automatic}};
      const auditEvents=[
        commandEvent({type:"decision.evaluated",input,paper,strategy:intent.strategy,payload:evidence}),
        commandEvent({type:"order.intent.created",input,paper,strategy:intent.strategy,payload:intentPayload,occurredAt:intent.createdAt}),
        commandEvent({type:"paper.execution.completed",input,paper,strategy:intent.strategy,payload:resultPayload,occurredAt:result.completedAt})
      ];
      return {ok:result.status==="filled",message:result.message,execution:result,auditEvents};
    });
  }
  return {command};
}
module.exports={createPaperService};
