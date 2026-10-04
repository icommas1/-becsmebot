// Run on the dedicated evaluator host, never inside the web process or candidate container.
const {readFileSync,statSync}=require('node:fs');
const {createPrivateKey,sign}=require('node:crypto');
const {execFile}=require('node:child_process');
const {canonical}=require('../src/events/becs-event');
const {isValid}=require('../src/api/validation');
async function main(){
  const manifest=process.argv[2],keyPath=process.env.AGENT_EVALUATOR_PRIVATE_KEY_FILE;
  if(!manifest||!keyPath||(statSync(keyPath).mode&0o077))throw Error('Private signing key file required');
  const key=createPrivateKey(readFileSync(keyPath));if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 key required');
  const report=await new Promise((resolve,reject)=>execFile('python3',[require.resolve('./agent-runner.py'),manifest],
    {timeout:120000,maxBuffer:65536,env:{PATH:process.env.PATH}},(error,stdout)=>{
      if(error)return reject(error);try{resolve(JSON.parse(stdout));}catch(e){reject(e);}
    }));
  if(!isValid('agentEvaluationReport',report))throw Error('Invalid evaluator report');
  const signature=sign(null,Buffer.from(JSON.stringify(canonical(report))),key).toString('base64');
  process.stdout.write(JSON.stringify({report,signature})+'\n');
}
if(require.main===module)main().catch(()=>{console.error('Agent evaluation failed; no receipt issued.');process.exitCode=1;});
module.exports={main};
