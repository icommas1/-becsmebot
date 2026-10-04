const {verifyEvent,digest}=require("../events/becs-event");
const {isCanonicalMint}=require("../market/mint");
const {limits,text,fail}=require("./config");
const positive=value=>typeof value==="number"&&Number.isFinite(value)&&value>0;
const nonnegative=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0;
const time=value=>typeof value==="number"?value:typeof value==="string"?Date.parse(value):NaN;
const at=value=>Number.isSafeInteger(time(value))&&time(value)>=0;
const check=(value,code="invalid_observed_event")=>{if(!value)fail(code);};

function eventReference(event){return {kind:"becs-event",streamId:event.streamId,sequence:event.sequence,eventId:event.eventId,
  eventHash:event.eventHash,payloadHash:event.payloadHash,schemaVersion:event.schemaVersion};}

// Copy only documented observation fields; never forward arbitrary provider/client payloads.
function projectEvent(event,scope){
  check(verifyEvent(event,{streamId:event.streamId,sequence:event.sequence,previousHash:event.previousHash}));
  if(event.accountId!==scope.accountId)return null;
  const p=event.payload;
  const base={type:event.type,occurredAt:event.occurredAt,requestId:event.requestId,accountId:event.accountId,
    strategy:event.strategy?{id:event.strategy.id,version:event.strategy.version}:null,reference:eventReference(event)};
  if(event.type==="paper.wallet.reset")return {...base,payload:{}};
  if(!["decision.evaluated","order.intent.created","paper.execution.completed"].includes(event.type))return null;
  check(event.source==="paper-service"&&text(event.requestId,100)&&p&&typeof p==="object"&&
    text(event.strategy?.id,100)&&text(event.strategy?.version,100));
  if(event.type==="decision.evaluated"){
    const d=p.decision;check(["buy","sell"].includes(d?.side)&&text(d.reason,500)&&text(d.source,100)&&typeof d.automatic==="boolean");
    return {...base,payload:{decision:{side:d.side,reason:d.reason,source:d.source,automatic:d.automatic}}};
  }
  check(p.accountId===scope.accountId&&p.intentId===event.requestId);
  if(event.type==="order.intent.created"){
    check(isCanonicalMint(p.asset)&&["buy","sell"].includes(p.side)&&at(p.createdAt));
    check(p.strategy?.id===event.strategy.id&&p.strategy?.version===event.strategy.version);
    check(positive(p.quantity?.value)&&
      (p.quantity.mode==="quote"&&p.quantity.unit==="USD"||p.side==="sell"&&p.quantity.mode==="position_fraction"&&p.quantity.unit==="fraction"&&p.quantity.value<=1));
    return {...base,payload:{intentId:p.intentId,asset:p.asset,side:p.side,
      quantity:{value:p.quantity.value,mode:p.quantity.mode,unit:p.quantity.unit},createdAt:p.createdAt}};
  }
  check(p.executionMode==="paper","unsupported_execution_provenance");
  check(p.status==="filled"&&positive(p.filledQuantity)&&positive(p.filledQuoteQuantity)&&positive(p.fillPrice)&&
    nonnegative(p.fees?.amount)&&p.fees.currency==="USD"&&at(p.completedAt)&&at(p.createdAt));
  return {...base,payload:{intentId:p.intentId,executionMode:p.executionMode,status:p.status,filledQuantity:p.filledQuantity,
    filledQuoteQuantity:p.filledQuoteQuantity,fillPrice:p.fillPrice,fees:{amount:p.fees.amount,currency:p.fees.currency},
    createdAt:p.createdAt,completedAt:p.completedAt}};
}

function observedFill(decision,intent,execution){
  check(decision?.type==="decision.evaluated"&&intent?.type==="order.intent.created"&&execution?.type==="paper.execution.completed",
    "missing_purchase_context");
  check(decision.reference.sequence+1===intent.reference.sequence&&intent.reference.sequence+1===execution.reference.sequence&&
    [decision,intent].every(e=>e.requestId===execution.requestId&&e.accountId===execution.accountId&&
      e.strategy.id===execution.strategy.id&&e.strategy.version===execution.strategy.version)&&
    intent.payload.side===decision.payload.decision.side,"conflicting_purchase_context");
  check(time(execution.payload.completedAt)===execution.occurredAt&&time(execution.payload.createdAt)===time(intent.payload.createdAt)&&
    execution.occurredAt>=time(intent.payload.createdAt),"invalid_fill_timestamp");
  return {asset:intent.payload.asset,side:intent.payload.side,occurredAt:execution.occurredAt,executionMode:execution.payload.executionMode,
    classification:intent.payload.side==="buy"?"recorded-paper-purchase":"recorded-paper-sale",strategy:execution.strategy,
    decision:decision.payload.decision,fill:execution.payload,references:[decision.reference,intent.reference,execution.reference]};
}

function archivedMarks(payload,record){
  check(payload?.schemaVersion===1&&Array.isArray(payload.radar)&&payload.radar.length<=limits.radarRows&&at(payload.scanAt),"unsupported_market_archive_contract");
  const scanAt=time(payload.scanAt);check(scanAt===Number(record.occurred_at)&&scanAt<=Number(record.captured_at),"conflicting_market_timestamp");
  const rows=new Map();
  for(const row of payload.radar){
    if(!isCanonicalMint(row?.mint)||!positive(row.priceUsd)||row.isSus!==false||!at(row.observedAt)||
      time(row.observedAt)>scanAt||scanAt-time(row.observedAt)>limits.markMaxAgeMs||!text(row.priceFeed,100))continue;
    const mark={asset:row.mint,priceUsd:row.priceUsd,observedAt:time(row.observedAt),priceFeed:row.priceFeed};
    if(rows.has(row.mint)&&digest(rows.get(row.mint))!==digest(mark))fail("ambiguous_archived_mark");
    rows.set(row.mint,mark);
  }
  return [...rows.values()];
}
module.exports={eventReference,projectEvent,observedFill,archivedMarks,time};
