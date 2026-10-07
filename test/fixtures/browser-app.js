const express=require("express"),{randomUUID}=require("node:crypto");
const {createApp}=require("../../src/api/app");
const {fixtureMarket}=require("./market");
// Each browser context starts with its own actual fixture scan. Suite duration
// must not age every later test's marks; existing marks are never relabeled.
// Keep the cap above the full multi-browser suite while bounding fixture memory.
async function browserFixtureApp({marketFactory=fixtureMarket,maxContexts=512}={}){
  const shared=createApp(await marketFactory()),contexts=new Map(),app=express();app.disable("x-powered-by");
  app.use(async(req,res,next)=>{
    if(req.path==="/health")return shared(req,res,next);
    const token=(req.headers.cookie||"").split(";").map(s=>s.trim()).find(s=>s.startsWith("becs-fixture="))?.slice(13);
    let context=contexts.get(token);
    if(!context){
      if(contexts.size>=maxContexts)return res.status(503).json({error:"Browser fixture capacity reached."});
      const id=randomUUID();context=createApp(await marketFactory());contexts.set(id,context);
      res.cookie("becs-fixture",id,{httpOnly:true,sameSite:"strict",path:"/"});
    }
    context(req,res,next);
  });
  return app;
}
module.exports={browserFixtureApp};
