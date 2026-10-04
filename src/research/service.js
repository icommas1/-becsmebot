"use strict";
const {createHash}=require("node:crypto");
const {isIP}=require("node:net");
const {callSearch,ResearchError}=require("./mcp-client");
const {limits}=require("./config");
const CATALOG=Object.freeze([
  {id:"exa",name:"Exa",role:"Public-web research",kind:"reader",access:"Keyless, rate-limited",note:"On-demand research, not a real-time market-price feed."},
  {id:"parallel",name:"Parallel Search",role:"Public-web research",kind:"reader",access:"Keyless, rate-limited",note:"A second reader. The same original page is still one piece of evidence."},
  {id:"google-drive",name:"Google Drive",role:"Project documents",kind:"support",access:"Assistant-managed",note:"Private documents are not automatically sent to search providers or published here."},
  {id:"gsc-wizard",name:"GSC Wizard",role:"Owned-site search analytics",kind:"support",access:"Requires a verified property",note:"Not a global crypto sentiment or market feed."},
  {id:"github",name:"GitHub",role:"Code, reviews and tests",kind:"support",access:"Assistant-managed",note:"Development tooling; never a trading signal."},
  {id:"railway",name:"Railway",role:"Application hosting",kind:"support",access:"Current runtime",note:"Runs this application. Hosting is separate from reader access."},
  {id:"magicpath",name:"MagicPath",role:"Interface design",kind:"support",access:"Assistant-managed; quota applies",note:"Design tooling; not a trading signal or price source."},
  {id:"supabase",name:"Supabase",role:"Optional database tooling",kind:"support",access:"Separate project required",note:"Not provisioned by this feature. Existing PostgreSQL and archive settings are unchanged."}
]);
function requestInput(input){
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!['query','providers'].includes(k)))throw new ResearchError("invalid_request","Use a public query and one or both supported readers.",400);
  const query=typeof input.query==="string"?input.query.trim():"";
  if(query.length<limits.queryMin||query.length>limits.queryMax||/[\x00-\x1f\x7f]/.test(query))throw new ResearchError("invalid_query","Enter a public query of 3–240 characters.",400);
  const providers=input.providers;
  if(!Array.isArray(providers)||providers.length<1||providers.length>2||new Set(providers).size!==providers.length||providers.some(p=>p!=="exa"&&p!=="parallel"))throw new ResearchError("invalid_provider","Choose Exa, Parallel Search, or both.",400);
  return {query,providers:[...providers].sort()};
}
function publicUrl(value){
  try {
    if(typeof value!=="string"||value.length>2048)return null;
    const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,"");
    if(url.protocol!=="https:"||url.username||url.password||url.port||!host.includes(".")||isIP(host.replace(/^\[|\]$/g,""))||/\.(local|localhost|internal|test|invalid)$/.test(host))return null;
    for(const key of url.searchParams.keys())if(/^(token|api[_-]?key|secret|authorization|password|access[_-]?token)$/i.test(key))return null;
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(gclid|fbclid)$/i.test(key))url.searchParams.delete(key);
    url.hash="";url.searchParams.sort();return url.toString();
  }catch{return null;}
}
function normalizeReply(reply,provider,at){
  if(reply?.isError)throw new ResearchError("provider_unavailable","Reader returned an error.");
  let rows=null;const texts=[];
  function inspect(value){
    if(!value||typeof value!=="object")return;
    if(Array.isArray(value.results))rows=value.results;
    else if(Array.isArray(value.data?.results))rows=value.data.results;
    if(typeof value.text==="string")texts.push(value.text);
  }
  inspect(reply?.structuredContent);inspect(reply);
  for(const block of reply?.content||[])if(block.type==="text"&&typeof block.text==="string"){
    try{inspect(JSON.parse(block.text));}catch{texts.push(block.text);}
  }
  if(rows===null){
    rows=[];let recognized=false;
    for(const text of texts){
      for(const block of text.split(/(?:^|\n)Title:\s*/).slice(1)){
        const url=block.match(/(?:^|\n)URL:\s*(https?:\/\/[^\s]+)/)?.[1];
        if(!url)continue;recognized=true;
        rows.push({url,title:block.split("\n")[0],text:block.replace(/^[\s\S]*?\n(?:Highlights|Text|Excerpt):\s*/,"")});
      }
      if(/^\s*(no (search )?results( found)?[.!]?|\[\])\s*$/i.test(text))recognized=true;
    }
    if(!recognized)throw new ResearchError("invalid_response","Reader response could not be validated.");
  }
  const documents=[];
  for(const row of rows.slice(0,limits.providerRows)){
    const url=publicUrl(row?.url);if(!url)continue;
    const title=typeof row.title==="string"?row.title.slice(0,240):new URL(url).hostname;
    const parts=Array.isArray(row.excerpts)?row.excerpts:Array.isArray(row.highlights)?row.highlights:[row.text??row.excerpt??""];
    const excerpt=parts.filter(v=>typeof v==="string").join("\n").slice(0,1600);
    documents.push({id:createHash("sha256").update(url).digest("hex").slice(0,24),url,title,excerpt,
      host:new URL(url).hostname,retrievedAt:at,readers:[provider]});
    if(documents.length===limits.documentsPerReader)break;
  }
  return documents;
}
function mergeDocuments(batches){
  const entries=new Map();
  for(const docs of batches)for(const doc of docs){
    const previous=entries.get(doc.url);
    if(previous){for(const reader of doc.readers)if(!previous.readers.includes(reader))previous.readers.push(reader);}
    else entries.set(doc.url,{...doc,readers:[...doc.readers]});
  }
  return [...entries.values()];
}
function createResearchService({search=callSearch,now=Date.now,maxRuns=limits.maxRuns,cooldownMs=limits.cooldownMs,cacheMs=limits.cacheMs}={}){
  let running=false,hits=[];const cache=new Map();
  const states={exa:{status:"untested",lastSuccessAt:null,lastError:null},parallel:{status:"untested",lastSuccessAt:null,lastError:null}};
  return {
    status(){return {executionEnabled:false,paidFallback:false,storage:"memory-only",onDemand:true,running,
      limits:{runsPerDay:maxRuns,cacheSeconds:cacheMs/1000},catalog:CATALOG.map(item=>({...item,...(states[item.id]||{status:"support-only"})}))};},
    async run(input){
      const request=requestInput(input),key=JSON.stringify(request),time=now();
      hits=hits.filter(at=>at>time-86400000);
      const previous=cache.get(key);
      if(previous&&time-previous.createdAt<cacheMs)return {...structuredClone(previous.value),cached:true};
      if(running)throw new ResearchError("busy","Research is already running. Try again shortly.",429);
      if(hits.length>=maxRuns||hits.some(at=>time-at<cooldownMs))throw new ResearchError("local_limit","Research limit reached. Retry later; no paid fallback is enabled.",429);
      hits.push(time);running=true;
      try{
        const responses=await Promise.all(request.providers.map(async id=>{
          try{
            const reply=await search(id,request.query);const retrievedAt=new Date(now()).toISOString();
            const documents=normalizeReply(reply,id,retrievedAt);
            states[id]={status:"ready",lastSuccessAt:retrievedAt,lastError:null};
            return {id,status:"ready",error:null,documents};
          }catch(error){
            const status=error?.code==="rate_limited"?"limited":"unavailable";
            const message=error instanceof ResearchError?error.message:"Reader unavailable.";
            states[id]={...states[id],status,lastError:message};
            return {id,status,error:message,documents:[]};
          }
        }));
        const documents=mergeDocuments(responses.map(r=>r.documents));
        const value={query:request.query,retrievedAt:new Date(now()).toISOString(),cached:false,executionEnabled:false,
          providers:responses.map(({documents,...rest})=>({...rest,documentCount:documents.length})),
          documentCount:documents.length,distinctHosts:new Set(documents.map(d=>d.host)).size,documents,
          note:"Reader agreement is not independent-source confirmation, a buy signal, a live quote or a measured win rate."};
        // Errors are never silently presented as cached successful research.
        if(responses.every(r=>r.status==="ready")){cache.set(key,{createdAt:time,value:structuredClone(value)});if(cache.size>limits.cacheBatches)cache.delete(cache.keys().next().value);}
        return value;
      }finally{running=false;}
    }
  };
}
module.exports={CATALOG,requestInput,publicUrl,normalizeReply,mergeDocuments,createResearchService};
