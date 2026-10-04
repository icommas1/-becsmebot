"use strict";
const path=require("node:path");
const {createResearchService}=require("./service");
const {ResearchError}=require("./mcp-client");
const {assertResearch}=require("./validation");
function mountResearchRoutes(app,paperAccounts={config:{enabled:false}},service=createResearchService()){
  const {config,store}=paperAccounts;
  let attempts=[];
  app.get("/research",(_req,res)=>res.sendFile(path.join(__dirname,"../web/research.html")));
  app.get("/api/research/status",(_req,res)=>res.json(assertResearch("status",{...service.status(),ownerSignInRequired:true,accountEnabled:!!config?.enabled})));
  app.post("/api/research/query",async(req,res)=>{
    try{
      if(!config?.enabled||!store)return res.status(503).json({error:"Private server account is not configured. No research was sent."});
      if(req.get("Origin")!==config.origin||req.get("Sec-Fetch-Site")==="cross-site")return res.status(403).json({error:"Same-origin request required."});
      const token=(req.headers.cookie||"").split(";").map(v=>v.trim()).find(v=>v.startsWith("__Host-becs-session="))?.slice(20)||"";
      if(!token||token.length>128)return res.status(401).json({error:"Sign in with the BecsBot owner's GitHub account."});
      const now=Date.now();attempts=attempts.filter(at=>now-at<60000);
      if(attempts.length>=60){res.set("Retry-After","60");return res.status(429).json({error:"Research access busy. Retry shortly."});}
      attempts.push(now);
      const user=await store.session(token);
      if(user!=="github:"+config.ownerId)return res.status(401).json({error:"Sign in with the BecsBot owner's GitHub account."});
      res.json(assertResearch("response",await service.run(req.body)));
    }catch(error){
      if(error instanceof ResearchError){if(error.status===429)res.set("Retry-After","60");return res.status(error.status).json({error:error.message,code:error.code});}
      res.status(503).json({error:"Research temporarily unavailable. No trade was submitted."});
    }
  });
}
module.exports={mountResearchRoutes};
