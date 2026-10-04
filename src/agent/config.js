const {createPublicKey,createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {digest}=require('../events/becs-event');
const policy=require('./policy.json');
const limits=Object.freeze({poolSize:2,connectionMs:3000,statementMs:5000,transactionIdleMs:10000,waitingRequests:8,clockSkewMs:30000});
function verifierHash(){return createHash('sha256').update(readFileSync(require.resolve('../../scripts/agent-runner.py'))).digest('hex');}
function agentConfig(env,accounts){
  if(env.AGENT_TOOLS_ENABLED!=='true')return {enabled:false};
  if(!accounts.enabled)throw Error('Agent tools require configured owner authentication');
  if(!/^node:24-alpine@sha256:[a-f0-9]{64}$/.test(env.AGENT_EVALUATOR_IMAGE||''))throw Error('Agent evaluator requires an immutable Node 24 Alpine image');
  let publicKey;
  try{publicKey=createPublicKey(env.AGENT_EVALUATOR_PUBLIC_KEY);if(publicKey.asymmetricKeyType!=='ed25519')throw Error();}
  catch{throw Error('Agent evaluator requires an Ed25519 public key');}
  return {enabled:true,owner:'github:'+accounts.ownerId,databaseUrl:accounts.databaseUrl,image:env.AGENT_EVALUATOR_IMAGE,
    publicKey,policy,policyHash:digest(policy),verifierHash:verifierHash()};
}
module.exports={agentConfig,policy,verifierHash,limits};
