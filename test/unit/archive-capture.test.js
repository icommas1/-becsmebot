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

test("a complete fsynced temporary record from an exited process is recovered once",async()=>{
  const dataDir=fs.mkdtempSync(path.join(tmpdir(),"becs-temp-recovery-")),directory=path.join(dataDir,"research-pending","test");
  const entry={...record(),recordId:require("node:crypto").randomUUID()};
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,"0000000000000001-"+entry.recordId+".json.gz");
  const child=require("node:child_process").spawnSync(process.execPath,["-e",
    'const fs=require("node:fs"),{encode}=require(process.argv[1]);const fd=fs.openSync(process.argv[2],"w",0o600);fs.writeFileSync(fd,encode(JSON.parse(process.argv[3])).compressed);fs.fsyncSync(fd);process.exit(23);',
    require.resolve("../../src/archive/store"),file+".tmp",JSON.stringify(entry)]);
  assert.equal(child.status,23);
  const seen=[];
  try{
    const archive={streamId:"test",record:async value=>{seen.push(value);return {sequence:1};}};
    const capture=createArchiveCapture({archive,dataDir,logger:quiet});await capture.flush();await capture.flush();
    assert.deepEqual(seen,[entry]);assert.equal(capture.status().pendingRecords,0);
    assert.deepEqual(fs.readdirSync(directory),[]);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test("incomplete or conflicting temporary evidence blocks scans and is never discarded",async()=>{
  const dataDir=fs.mkdtempSync(path.join(tmpdir(),"becs-temp-invalid-")),directory=path.join(dataDir,"research-pending","test");
  fs.mkdirSync(directory,{recursive:true});
  const entry={...record(),recordId:require("node:crypto").randomUUID()},file=path.join(directory,"0000000000000001-"+entry.recordId+".json.gz");
  try{
    fs.writeFileSync(file+".tmp","incomplete");
    const archive={streamId:"test",record:async()=>assert.fail("Unresolved evidence must block delivery")};
    const capture=createArchiveCapture({archive,dataDir,logger:quiet});await capture.flush();
    assert.equal(capture.canCapture(),false);assert.equal(capture.status().pendingRecords,1);
    assert.equal(fs.readFileSync(file+".tmp","utf8"),"incomplete");
    const {encode}=require("../../src/archive/store");
    fs.writeFileSync(file,encode(entry).compressed);
    fs.writeFileSync(file+".tmp",encode({...entry,payload:{different:true}}).compressed);
    await capture.flush();assert.equal(capture.canCapture(),false);assert.equal(capture.status().pendingRecords,2);
    assert.equal(fs.existsSync(file),true);assert.equal(fs.existsSync(file+".tmp"),true);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});
