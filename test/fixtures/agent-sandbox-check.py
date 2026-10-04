"""CI-only verification on a disposable Docker host; no production credentials."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('runner',root/'scripts/agent-runner.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
image=os.environ['AGENT_TEST_IMAGE']
code="""const fs=require('fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));const e=new Set(x.events),m=new Set(x.memory);console.log(JSON.stringify({missing:[...e].filter(v=>!m.has(v)).sort(),orphan:[...m].filter(v=>!e.has(v)).sort(),duplicate:[...m].filter(v=>x.memory.filter(w=>v===w).length>1).sort()}));"""
def manifest(source):
    bundle={'version':1,'name':'fixture','code':source,'codeHash':hashlib.sha256(source.encode()).hexdigest(),
        'capability':runner.POLICY['capability'],'permissions':runner.POLICY['permissions'],'policyHash':runner.digest(runner.POLICY),
        'verifierHash':hashlib.sha256((root/'scripts/agent-runner.py').read_bytes()).hexdigest(),'image':image}
    now=int(time.time()*1000)
    return {'bundle':bundle,'bundleHash':runner.digest(bundle),'policy':runner.POLICY,
        'evaluationId':str(uuid.uuid4()),'nonce':'a'*64,'reservedAt':now,'expiresAt':now+900000}
good=runner.evaluate(manifest(code))
assert good['isolationVerified'] and good['passed']==good['total']==6,good
bad=runner.evaluate(manifest('console.log(JSON.stringify({missing:[],orphan:[],duplicate:[]}))'))
assert bad['passed']<bad['total'],bad
hung=runner.docker_case(image,'while(true){}',{})
assert hung['outcome']=='timeout',hung
flood=runner.docker_case(image,"for(let i=0;i<10000;i++)console.log('x'.repeat(1024));",{})
assert flood['outcome']=='output_limit',flood
remaining=subprocess.run(['docker','ps','-aq','--filter','name=becs-eval-'],capture_output=True,text=True,check=True)
assert not remaining.stdout.strip(),'Orphaned evaluation container'
print(json.dumps({'goodCasesPassed':good['passed'],'falseAllClearCasesPassed':bad['passed'],
    'isolationVerified':good['isolationVerified'],'timeoutStopped':True,'outputStopped':True,'containersRemaining':0}))
