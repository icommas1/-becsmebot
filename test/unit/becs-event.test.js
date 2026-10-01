const test=require("node:test"),assert=require("node:assert/strict");
const {createEventDraft,materializeEvent,digest,verifyChain}=require("../../src/events/becs-event");
const {merkleRoot,createLocalHashProofProvider}=require("../../src/proof/local-hash");

test("BecsEvents canonicalize payloads and form a tamper-evident chain",()=>{
  assert.equal(digest({b:2,a:{z:3,y:1}}),digest({a:{y:1,z:3},b:2}));
  const streamId="paper:"+"a".repeat(64);
  const first=materializeEvent({draft:createEventDraft({type:"decision.evaluated",source:"test",payload:{b:2,a:1},occurredAt:1}),
    streamId,sequence:1});
  const second=materializeEvent({draft:createEventDraft({type:"order.intent.created",source:"test",payload:{side:"buy"},occurredAt:2}),
    streamId,sequence:2,previousHash:first.eventHash});
  assert.deepEqual(verifyChain([first,second],{streamId}),{valid:true,verified:2,failedSequence:null,headHash:second.eventHash});
  const tampered={...second,payload:{side:"sell"}};
  assert.equal(verifyChain([first,tampered],{streamId}).valid,false);
});

test("local proof provider creates deterministic Merkle roots for contiguous event batches",()=>{
  const streamId="paper:"+"b".repeat(64),events=[];let previousHash=null;
  for(let sequence=1;sequence<=3;sequence++){
    const event=materializeEvent({draft:createEventDraft({type:"test.event",source:"test",payload:{sequence},occurredAt:sequence}),
      streamId,sequence,previousHash});events.push(event);previousHash=event.eventHash;
  }
  assert.match(merkleRoot(events.map(event=>event.eventHash)),/^[0-9a-f]{64}$/);
  const provider=createLocalHashProofProvider({now:()=>123});
  const proof=provider.prove(events);
  assert.equal(proof.provider,"local-hash-v1");assert.equal(proof.eventCount,3);assert.equal(proof.createdAt,123);
  assert.equal(provider.verify(events,proof),true);
  assert.equal(provider.verify(events.slice(0,2),proof),false);
});
