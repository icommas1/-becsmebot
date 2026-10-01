const {createHash,randomUUID}=require("node:crypto");
const {createProofProvider}=require("./provider");

const HASH=/^[a-f0-9]{64}$/;
const hashPair=(left,right)=>createHash("sha256").update(left+right).digest("hex");

function merkleRoot(hashes){
  if(!Array.isArray(hashes)||!hashes.length||hashes.some(hash=>!HASH.test(hash)))throw Error("Invalid proof event hashes");
  let layer=[...hashes];
  while(layer.length>1){
    const next=[];
    for(let i=0;i<layer.length;i+=2){
      const left=layer[i],right=layer[i+1]||left;
      next.push(hashPair(left,right));
    }
    layer=next;
  }
  return layer[0];
}

function createLocalHashProofProvider({now=Date.now}={}){
  return createProofProvider({
    id:"local-hash-v1",
    prove(events){
      if(!Array.isArray(events)||!events.length)throw Error("Cannot prove an empty BecsEvent batch");
      const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);
      const streamId=ordered[0].streamId;
      if(ordered.some((event,index)=>event.streamId!==streamId||index&&event.sequence!==ordered[index-1].sequence+1))
        throw Error("BecsEvent proof batch must be one contiguous stream");
      return {
        proofId:randomUUID(),provider:"local-hash-v1",streamId,
        firstSequence:ordered[0].sequence,lastSequence:ordered.at(-1).sequence,eventCount:ordered.length,
        rootHash:merkleRoot(ordered.map(event=>event.eventHash)),createdAt:now()
      };
    },
    verify(events,proof){
      try{
        if(!proof||proof.provider!=="local-hash-v1"||!Array.isArray(events)||events.length!==proof.eventCount)return false;
        const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);
        return ordered.length>0&&ordered[0].streamId===proof.streamId&&ordered[0].sequence===proof.firstSequence&&
          ordered.at(-1).sequence===proof.lastSequence&&
          ordered.every((event,index)=>event.streamId===proof.streamId&&event.sequence===proof.firstSequence+index)&&
          merkleRoot(ordered.map(event=>event.eventHash))===proof.rootHash;
      }catch{return false;}
    }
  });
}

module.exports={merkleRoot,createLocalHashProofProvider};
