const {randomBytes,createHash,timingSafeEqual}=require("node:crypto");
const {limits}=require("./config");
const {createPaperService}=require("./service");
const SESSION="__Host-becs-session",STATE="__Host-becs-oauth";
const cookie=(req,name)=>(req.headers.cookie||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(name+"="))?.slice(name.length+1)||"";
const cookieOptions={httpOnly:true,secure:true,sameSite:"lax",path:"/"};
const equal=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function githubIdentity(config,code,verifier) {
  async function json(url,options={}) {
    const response=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(10000),headers:{Accept:"application/json",...options.headers}});
    if(!response.ok)throw Error("GitHub sign-in unavailable");
    const reader=response.body.getReader();let bytes=0,chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)throw Error("GitHub response too large");chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const token=await json("https://github.com/login/oauth/access_token",{method:"POST",body:new URLSearchParams({client_id:config.clientId,
    client_secret:config.clientSecret,code,code_verifier:verifier,redirect_uri:config.origin+"/api/auth/github/callback"})});
  if(typeof token.access_token!=="string")throw Error("GitHub sign-in failed");
  const user=await json("https://api.github.com/user",{headers:{Authorization:"Bearer "+token.access_token,"User-Agent":"BecsBot","X-GitHub-Api-Version":"2022-11-28"}});
  if(!Number.isSafeInteger(user.id))throw Error("GitHub identity unavailable");
  return String(user.id); // OAuth token is neither stored nor sent to the browser.
}
function mountPaperRoutes(app,{config,store,market,identity=githubIdentity}) {
  app.get("/api/paper/capabilities",(_req,res)=>res.json({enabled:!!config.enabled}));
  if(!config.enabled)return;
  const service=createPaperService({store,market}),owner="github:"+config.ownerId;
  let hits=[],active=0;
  function limit(_req,res,next){const now=Date.now();hits=hits.filter(at=>at>now-60000);if(hits.length>=120){res.set("Retry-After","60");return res.status(429).json({error:"Paper requests busy. Try again shortly."});}hits.push(now);next();}
  app.use(["/api/auth","/api/paper/account","/api/paper/commands"],limit);
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status([400,401,403,409].includes(error.status)?error.status:503).json({error:[400,401,403,409].includes(error.status)?error.message:"Server paper account temporarily unavailable. Retry the same action."});}};
  async function authenticated(req,res){const user=await store.session(cookie(req,SESSION));if(user!==owner){res.status(401).json({error:"Sign in to your server paper account."});return null;}return user;}
  function sameOrigin(req,res){if(req.get("Origin")!==config.origin||req.get("Sec-Fetch-Site")==="cross-site"){res.status(403).json({error:"Same-origin request required."});return false;}return true;}
  app.get("/api/auth/status",safe(async(req,res)=>{const user=await store.session(cookie(req,SESSION));res.json({authenticated:user===owner});}));
  app.get("/api/auth/github",safe(async(req,res)=>{
    if(req.get("Sec-Fetch-Site")==="cross-site")return res.status(403).json({error:"Start sign-in from BecsBot."});
    const state=randomBytes(32).toString("base64url"),verifier=randomBytes(32).toString("base64url");
    await store.flow(state,verifier);res.cookie(STATE,state,{...cookieOptions,maxAge:limits.flowMs});
    const url=new URL("https://github.com/login/oauth/authorize");
    url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.origin+"/api/auth/github/callback",state,
      code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",allow_signup:"false"}).toString();
    res.redirect(url.toString());
  }));
  app.get("/api/auth/github/callback",safe(async(req,res)=>{
    const state=req.query.state,code=req.query.code;
    res.clearCookie(STATE,cookieOptions);
    if(!/^[\w-]{43}$/.test(state||"")||!equal(state,cookie(req,STATE))||typeof code!=="string"||code.length>256)
      return res.status(400).json({error:"Invalid sign-in callback. Start again from BecsBot."});
    const verifier=await store.consumeFlow(state);if(!verifier)return res.status(400).json({error:"Sign-in expired. Start again from BecsBot."});
    if(await identity(config,code,verifier)!==config.ownerId)return res.status(403).json({error:"This paper account is private."});
    await store.ensureAccount(owner);
    // Rotate an existing session when signing in again.
    if(cookie(req,SESSION))await store.logout(cookie(req,SESSION));
    const token=await store.createSession(owner);
    res.cookie(SESSION,token,{...cookieOptions,maxAge:limits.sessionMs});res.redirect("/terminal");
  }));
  app.post("/api/auth/logout",safe(async(req,res)=>{if(!sameOrigin(req,res))return;await store.logout(cookie(req,SESSION));res.clearCookie(SESSION,cookieOptions);res.json({ok:true});}));
  app.get("/api/paper/account",safe(async(req,res)=>{const user=await authenticated(req,res);if(user)res.json(await store.read(user));}));
  app.post("/api/paper/commands",safe(async(req,res)=>{
    if(!sameOrigin(req,res))return;
    const user=await authenticated(req,res);if(!user)return;
    if(active>=4)return res.status(503).json({error:"Paper account busy. Retry the same action."});
    active++;try{res.json(await service.command(user,req.body));}finally{active--;}
  }));
}
module.exports={mountPaperRoutes,githubIdentity};
