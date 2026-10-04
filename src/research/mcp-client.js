"use strict";
const {limits}=require("./config");
const ENDPOINTS = Object.freeze({
  exa: {url:"https://mcp.exa.ai/mcp", tool:"web_search_exa"},
  parallel: {url:"https://search.parallel.ai/mcp", tool:"web_search"}
});
class ResearchError extends Error {
  constructor(code,message,status=503){super(message);this.code=code;this.status=status;}
}
const unavailable=()=>new ResearchError("provider_unavailable","Research provider unavailable. No trade was submitted.");

// Only these two fixed, public, keyless servers are reachable. No environment
// keys, user-supplied endpoints, OAuth tokens or execution tools are accepted.
async function callSearch(provider,query,{fetchImpl=globalThis.fetch,timeoutMs=limits.requestTimeoutMs}={}) {
  const target=Object.hasOwn(ENDPOINTS,provider)?ENDPOINTS[provider]:null;
  if(!target)throw new ResearchError("invalid_provider","Unsupported research reader.",400);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  let session=null,protocol="2025-03-26",sequence=0;
  async function rpc(method,params,notification=false){
    const id=notification?null:++sequence;
    const headers={"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":protocol};
    if(session)headers["Mcp-Session-Id"]=session;
    const response=await fetchImpl(target.url,{method:"POST",headers,redirect:"error",signal:controller.signal,
      body:JSON.stringify({jsonrpc:"2.0",...(notification?{}:{id}),method,params})});
    if(response.status===429){await response.body?.cancel().catch(()=>{});throw new ResearchError("rate_limited","Free reader quota reached. Retry later; no paid fallback is enabled.",429);}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw unavailable();}
    const nextSession=response.headers.get("mcp-session-id");
    if(nextSession){if(!/^[\x21-\x7e]{1,256}$/.test(nextSession))throw unavailable();session=nextSession;}
    if(notification){await response.body?.cancel().catch(()=>{});return null;}
    const type=response.headers.get("content-type")||"";
    if(!/application\/json|text\/event-stream/i.test(type)||!response.body)throw unavailable();
    const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,buffer="";
    const accept=value=>{
      if(!value||value.jsonrpc!=="2.0"||value.id!==id)return null;
      if(value.error)throw unavailable();
      if(!Object.hasOwn(value,"result"))throw unavailable();
      return {value:value.result};
    };
    try {
      while(true){
        const part=await reader.read();
        if(part.done)break;
        bytes+=part.value.byteLength;if(bytes>limits.responseBytes)throw new ResearchError("response_too_large","Research response exceeded the size limit.");
        buffer+=decoder.decode(part.value,{stream:true});
        if(/text\/event-stream/i.test(type)){
          buffer=buffer.replace(/\r\n/g,"\n");let boundary;
          while((boundary=buffer.indexOf("\n\n"))!==-1){
            const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
            const data=frame.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
            if(!data||data==="[DONE]")continue;
            const match=accept(JSON.parse(data));if(match)return match.value;
          }
        }
      }
      buffer+=decoder.decode();
      if(/application\/json/i.test(type)){const match=accept(JSON.parse(buffer));if(match)return match.value;}
      throw unavailable();
    } finally {await reader.cancel().catch(()=>{});}
  }
  try {
    const initialized=await rpc("initialize",{protocolVersion:protocol,capabilities:{},clientInfo:{name:"BecsBot-Research",version:"1.0.0"}});
    if(!["2024-11-05","2025-03-26","2025-06-18","2025-11-25"].includes(initialized?.protocolVersion))throw unavailable();
    protocol=initialized.protocolVersion;
    await rpc("notifications/initialized",{},true);
    const listing=await rpc("tools/list",{});
    if(!Array.isArray(listing?.tools)||!listing.tools.some(item=>item.name===target.tool))throw new ResearchError("unsupported_tool","The reader's search interface changed. Integration needs review.");
    const args=provider==="exa"?{query,objective:"Find public sources relevant to this query. Return source URLs and excerpts; do not place trades.",numResults:limits.documentsPerReader}:
      {objective:query,search_queries:[query],session_id:"becsbot-research-workbench-v1"};
    const result=await rpc("tools/call",{name:target.tool,arguments:args});
    if(result?.isError)throw unavailable();
    return result;
  } catch(error){
    if(error instanceof ResearchError)throw error;
    throw new ResearchError(controller.signal.aborted?"timeout":"provider_unavailable",controller.signal.aborted?"Research request timed out. No trade was submitted.":"Research provider unavailable. No trade was submitted.");
  } finally {clearTimeout(timeout);}
}
module.exports={callSearch,ResearchError,ENDPOINTS};
