const {isValid}=require('../api/validation');
function mountAgentRoutes(app,{registry,authenticated,sameOrigin,safe}){
  const base='/api/agent/tools';
  const route=(path,method,schema,fn)=>app[method](base+path,safe(async(req,res)=>{
    if(method!=='get'&&!sameOrigin(req,res))return;
    const user=await authenticated(req,res);if(!user)return;
    if(req.params.id&&!/^[a-f0-9]{64}$/.test(req.params.id)||Object.keys(req.query).length||schema&&!isValid(schema,req.body))
      return res.status(400).json({error:'Invalid agent request.'});
    res.json(await fn(user,req));
  }));
  route('','post','agentCandidateRequest',(u,r)=>registry.register(u,r.body));
  route('/:id','get',null,(u,r)=>registry.inspect(u,r.params.id));
  route('/:id/evaluations/reserve','post','agentEmptyRequest',(u,r)=>registry.reserve(u,r.params.id));
  route('/:id/evaluations','post','agentAttestationRequest',(u,r)=>registry.attest(u,r.params.id,r.body));
  route('/:id/approvals','post','agentApprovalRequest',(u,r)=>registry.approve(u,r.params.id,r.body.evaluationId));
  route('/:id/promote','post','agentPromotionRequest',(u,r)=>registry.promote(u,r.params.id,r.body));
}
module.exports={mountAgentRoutes};
