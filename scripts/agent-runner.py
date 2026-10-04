"""Trusted, offline Docker evaluator. Candidate source executes only in containers."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT/'src/agent/policy.json').read_text())

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def docker_case(image, source, value):
    """No inherited environment, host credentials, Docker socket or writable mounts."""
    policy = POLICY['runner']
    name = 'becs-eval-'+uuid.uuid4().hex
    output = bytearray()
    outcome = 'exited'
    with tempfile.TemporaryDirectory(prefix='becs-eval-') as directory:
        stage=Path(directory)
        stage.chmod(0o755)
        (stage/'tool.js').write_text(source)
        (stage/'tool.js').chmod(0o444)
        args=['docker','run','--rm','--name',name,'--pull=never','--network=none','--read-only',
              '--user',policy['uid'],'--cap-drop=ALL','--security-opt=no-new-privileges',
              '--memory='+str(policy['memoryMb'])+'m','--memory-swap='+str(policy['memoryMb'])+'m',
              '--cpus='+str(policy['cpus']),'--pids-limit='+str(policy['pids']),
              '--ulimit','nofile=64:64','--log-driver=none','--ipc=none',
              '--mount','type=bind,src='+str(stage)+',dst=/candidate,readonly',
              '--workdir=/candidate','--entrypoint=node','-i',image,'/candidate/tool.js']
        # Candidate inputs are finite fixture JSON. Environment belongs to Docker image only.
        with tempfile.TemporaryFile() as data:
            data.write(json.dumps(value).encode());data.seek(0)
            begin=time.monotonic()
            process=subprocess.Popen(args,stdin=data,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                                     env={'PATH':os.environ.get('PATH','/usr/bin:/bin')})
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout,selectors.EVENT_READ)
                    while selector.get_map():
                        remaining=policy['wallTimeMs']/1000-(time.monotonic()-begin)
                        if remaining<=0: outcome='timeout';break
                        for key,_ in selector.select(min(0.05,remaining)):
                            chunk=os.read(key.fileobj.fileno(),4096)
                            if not chunk:selector.unregister(key.fileobj);continue
                            if len(output)+len(chunk)>policy['maxOutputBytes']:outcome='output_limit';break
                            output.extend(chunk)
                        if outcome!='exited':break
                if outcome!='exited':process.kill()
                try:process.wait(timeout=max(0.01,policy['wallTimeMs']/1000-(time.monotonic()-begin)))
                except subprocess.TimeoutExpired:outcome='timeout';process.kill();process.wait(timeout=2)
            finally:
                process.stdout.close()
                # Killing the CLI is insufficient; always remove the container and all its processes.
                removed=subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=10)
                if removed.returncode and b'No such container' not in removed.stderr:
                    raise RuntimeError('Container cleanup could not be verified')
    return {'outcome':outcome,'code':process.returncode,'output':output.decode(errors='replace')}

PROBE=r'''
const fs=require('fs'),net=require('net');
const cfg=JSON.parse(fs.readFileSync(0,'utf8'));
const s=fs.readFileSync('/proc/self/status','utf8');
const memory=Number(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim());
const pids=Number(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim());
const [quota,period]=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\s+/).map(Number);
let readonly=false;try{fs.writeFileSync('/tmp/becs-probe','x')}catch(e){readonly=['EROFS','EACCES'].includes(e.code)}
const isolated=process.getuid()===Number(cfg.uid.split(':')[0])&&/^CapEff:\s+0+$/m.test(s)&&/^NoNewPrivs:\s+1$/m.test(s)&&
 readonly&&memory===cfg.memoryMb*1024*1024&&pids===cfg.pids&&quota/period===cfg.cpus&&
 !fs.existsSync('/var/run/docker.sock')&&!fs.existsSync('/root/.aws/credentials');
let done=false;const sock=net.connect({host:'1.1.1.1',port:443});
function result(denied){if(done)return;done=true;sock.destroy();console.log(JSON.stringify({isolated,networkDenied:denied}));}
sock.on('connect',()=>result(false));sock.on('error',()=>result(true));sock.setTimeout(500,()=>result(false));
'''

def evaluate(manifest):
    bundle=manifest['bundle']
    if manifest['policy']!=POLICY or bundle['policyHash']!=digest(POLICY) or digest(bundle)!=manifest['bundleHash']:
        raise ValueError('Policy or candidate digest mismatch')
    if bundle['verifierHash']!=hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
        raise ValueError('Verifier changed')
    if bundle['codeHash']!=hashlib.sha256(bundle['code'].encode()).hexdigest() or len(bundle['code'].encode())>POLICY['maxSourceBytes']:
        raise ValueError('Code mismatch')
    if not re.fullmatch(r'node:24-alpine@sha256:[a-f0-9]{64}',bundle['image']):raise ValueError('Pinned image required')
    now=int(time.time()*1000)
    if now<manifest['reservedAt'] or now>=manifest['expiresAt']:raise ValueError('Reservation expired')
    probe=docker_case(bundle['image'],PROBE,POLICY['runner'])
    verified=False
    if probe['outcome']=='exited' and probe['code']==0:
        verified=json.loads(probe['output'])=={'isolated':True,'networkDenied':True}
    passed=0
    if verified:
        for case in POLICY['cases']:
            result=docker_case(bundle['image'],bundle['code'],case['input'])
            try:
                ok=result['outcome']=='exited' and result['code']==0 and json.loads(result['output'])==case['expected']
            except (ValueError,UnicodeError):ok=False
            passed+=int(ok)
    return {'version':1,'evaluationId':manifest['evaluationId'],'bundleHash':manifest['bundleHash'],'nonce':manifest['nonce'],
            'policyHash':bundle['policyHash'],'verifierHash':bundle['verifierHash'],'image':bundle['image'],
            'completedAt':int(time.time()*1000),'isolationVerified':verified,'total':len(POLICY['cases']),'passed':passed}

if __name__=='__main__':
    try:
        path=Path(sys.argv[1])
        if path.stat().st_size>65536:raise ValueError('Manifest too large')
        print(json.dumps(evaluate(json.loads(path.read_text())),sort_keys=True,separators=(',',':')))
    except Exception:
        print('Agent evaluation unavailable; no success attestation issued.',file=sys.stderr)
        sys.exit(1)
