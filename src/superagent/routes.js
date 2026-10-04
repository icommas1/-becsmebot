const {limits}=require("./config");
const {validateCursor}=require("./report");
const {assertSchema}=require("../api/validation");
function parseCursor(query){
  if(Object.keys(query).some(key=>!["purchaseAfter","outcomeAfter"].includes(key)))throw Error("invalid_report_cursor");
  const raw=query.purchaseAfter??"0";
  if(typeof raw!=="string"||!/^\d{1,16}$/.test(raw))throw Error("invalid_report_cursor");
  let outcomeAfter=null;
  if(query.outcomeAfter!==undefined){
    if(typeof query.outcomeAfter!=="string"||query.outcomeAfter.length>limits.cursorBytes)throw Error("invalid_report_cursor");
    outcomeAfter=JSON.parse(query.outcomeAfter);
    if(!outcomeAfter||typeof outcomeAfter!=="object"||Array.isArray(outcomeAfter)||
      Object.keys(outcomeAfter).sort().join(",")!=="at,purchaseId,sourceKey")throw Error("invalid_report_cursor");
  }
  return validateCursor({purchaseAfter:Number(raw),outcomeAfter});
}
function mountReportRoutes(app,{config,store,reader=null}){
  const enabled=!!(config.enabled&&reader);
  app.get("/api/superagent/capabilities",(_req,res)=>res.json({enabled}));
  let active=0,hits=[];
  app.get("/api/superagent/report",async(req,res)=>{
    if(!enabled)return res.status(404).json({error:"Recorded report is disabled."});
    // Browser-only same-origin reads. No CORS, external bearer tokens or client scope selection.
    if(req.get("Sec-Fetch-Site")==="cross-site"||req.get("Origin")&&req.get("Origin")!==config.origin)
      return res.status(403).json({error:"Open the report from BecsBot."});
    const now=Date.now();hits=hits.filter(at=>at>now-60000);
    if(hits.length>=limits.reportRequestsPerMinute){res.set("Retry-After","60");return res.status(429).json({error:"Report requests busy. Try again shortly."});}
    hits.push(now);
    if(active>=limits.reportConcurrent)return res.status(503).json({error:"Recorded report temporarily unavailable."});
    active++;
    try{
      const identity=await store.reportIdentity((req.headers.cookie||"").split(";").map(s=>s.trim())
        .find(s=>s.startsWith("__Host-becs-session="))?.slice("__Host-becs-session=".length)||"");
      if(identity?.userId!=="github:"+config.ownerId)return res.status(401).json({error:"Sign in to your server paper account."});
      if(identity.accountId!==reader.config.accountId||identity.userId!==reader.config.ownerId||identity.executionMode!=="paper")
        return res.status(403).json({error:"Recorded report account mapping unavailable."});
      let cursor;try{cursor=parseCursor(req.query);}catch{return res.status(400).json({error:"Invalid report cursor."});}
      res.json(assertSchema("superagentReport",await reader.report(cursor)));
    }catch{res.status(503).json({error:"Recorded report temporarily unavailable."});}
    finally{active--;}
  });
}
module.exports={mountReportRoutes,parseCursor};
