const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),{tmpdir}=require("node:os");
const {createArchiveCapture}=require("../../src/archive/capture");
const quiet={log(){},error(){}};
const record=()=>({kind:"market.scan",source:"market",occurredAt:Date.now(),payload:{radar:[{mint:"A",price:1}]}});

test("archive spool survives database failure and process replacement with stable IDs",async()=>{
  const dataDir=fs.mkdtempSync(path.join(tmpdir(),"becs-spool-"));
  const committed=new Map();let online=false,lostReceipt=true;
  const archive={streamId:"test",record:async value=>{
    if(!online)throw Error("private connection detail");
    if(!committed.has(value.recordId))committed.set(value.recordId,{sequence:committed.size+1});
    if(lostReceipt){lostReceipt=false;throw Error("connection lost after commit");}
    return committed.get(value.recordId);
  }};
  try{
    let capture=createArchiveCapture({archive,dataDir,logger:quiet});
    await capture.capture(record());
    assert.equal(capture.status().pendingRecords,1);assert.equal(capture.status().healthy,false);
    assert.equal(capture.status().lastError,"delivery_or_verification_pending");
    online=true;await capture.flush();assert.equal(committed.size,1);
    capture=createArchiveCapture({archive,dataDir,logger:quiet});await capture.flush();
    assert.equal(committed.size,1);assert.equal(capture.status().pendingRecords,0);
    assert.equal(capture.status().lastSequence,1);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test("archive capacity stops new captures without deleting pending or blocked evidence",async()=>{
  const dataDir=fs.mkdtempSync(path.join(tmpdir(),"becs-capacity-"));let online=false;
  const archive={record:async()=>{if(!online)throw Error("offline");return {sequence:1};}};
  try{
    const capture=createArchiveCapture({archive,dataDir,logger:quiet,maxBytes:300});
    await capture.capture(record());assert.equal(capture.status().pendingRecords,1);
    await capture.capture({...record(),source:"wallet-intel"});
    assert.equal(capture.status().pendingRecords,1);assert.equal(capture.status().blockedRecords,1);
    assert.equal(capture.canCapture(),false);
    online=true;await capture.flush();assert.equal(capture.status().blockedRecords,0);
    await capture.flush();assert.equal(capture.status().pendingRecords,0);assert.equal(capture.canCapture(),true);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test("archive verification failure remains visible and never removes corrupted evidence",async()=>{
  const dataDir=fs.mkdtempSync(path.join(tmpdir(),"becs-integrity-"));
  try{
    const archive={record:async()=>({sequence:1}),verify:async()=>({valid:false,verified:0})};
    const capture=createArchiveCapture({archive,dataDir,logger:quiet});await capture.capture(record());await capture.flush();
    assert.equal(capture.status().lastError,"integrity_failed");assert.equal(capture.status().healthy,false);
    const file=path.join(dataDir,"research-pending","becs-research-v1","broken.json.gz");fs.writeFileSync(file,"broken");
    await capture.flush();assert.equal(fs.existsSync(file),true);assert.equal(capture.status().pendingRecords,1);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});
