const test=require('node:test');
const assert=require('node:assert/strict');
const {requestInput,publicUrl,normalizeReply,mergeDocuments,createResearchService,CATALOG}=require('../../src/research/service');
const {ResearchError,callSearch,ENDPOINTS}=require('../../src/research/mcp-client');
const at='2026-10-02T18:00:00.000Z';
const result=(url='https://example.com/launch')=>({structuredContent:{results:[{url,title:'Launch',excerpts:['Public source excerpt']}]}});

test('research accepts one or both readers and rejects arbitrary inputs',()=>{
  assert.deepEqual(requestInput({query:'  Solana launches  ',providers:['parallel','exa']}),{query:'Solana launches',providers:['exa','parallel']});
  for(const input of [null,[],{}, {query:'ab',providers:['exa']},{query:'a'.repeat(241),providers:['exa']},{query:'Solana\nlaunch',providers:['exa']},{query:'Solana',providers:[]},{query:'Solana',providers:['exa','exa']},{query:'Solana',providers:['github']},{query:'Solana',providers:['exa'],url:'https://private.invalid'}])assert.throws(()=>requestInput(input),{status:400});
});
test('the eight selected tools have two readers and no execution role',()=>{
  assert.equal(CATALOG.length,8);assert.deepEqual(CATALOG.filter(x=>x.kind==='reader').map(x=>x.id),['exa','parallel']);
  assert.ok(CATALOG.every(x=>x.role&&x.access&&x.note));
});
test('source URLs remove tracking and reject unsafe destinations or credential URLs',()=>{
  assert.equal(publicUrl('https://example.com/news?utm_source=exa&b=2&a=1#top'),'https://example.com/news?a=1&b=2');
  for(const url of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','https://localhost','https://localhost.','https://127.0.0.1','https://[::1]','https://2130706433','https://host.internal/x','https://example.com:9999/x','https://example.com?api_key=secret','https://example.com?access_token=secret'])assert.equal(publicUrl(url),null,url);
});
test('normalizes JSON and Exa text without inventing publication time or a price',()=>{
  const json=normalizeReply(result(),'parallel',at);
  const text=normalizeReply({content:[{type:'text',text:'Title: Launch\nURL: https://example.com/launch\nPublished: N/A\nHighlights:\nPublic source excerpt'}]},'exa',at);
  assert.equal(text[0].id,json[0].id);assert.equal(text[0].excerpt,'Public source excerpt');
  assert.equal(text[0].retrievedAt,at);assert.equal(text[0].priceUsd,undefined);assert.equal(text[0].publishedAt,undefined);
  assert.equal(normalizeReply({content:[{type:'text',text:JSON.stringify({results:[]})}]},'exa',at).length,0);
  assert.throws(()=>normalizeReply({content:[{type:'text',text:'Access denied: payment required'}]},'exa',at),{code:'invalid_response'});
});
test('documents are bounded and duplicate URLs count once across readers',()=>{
  const a=normalizeReply(result('https://example.com/launch?utm_source=exa'),'exa',at);
  const b=normalizeReply(result(),'parallel',at);
  const merged=mergeDocuments([a,b]);assert.equal(merged.length,1);assert.deepEqual(merged[0].readers,['exa','parallel']);
  assert.deepEqual(a[0].readers,['exa']);
  const rows=Array.from({length:20},(_,n)=>({url:`https://example.com/${n}`,title:'x'.repeat(300),text:'x'.repeat(5000)}));
  const docs=normalizeReply({structuredContent:{results:rows}},'exa',at);
  assert.equal(docs.length,6);assert.equal(docs[0].title.length,240);assert.equal(docs[0].excerpt.length,1600);
});
test('cached research retains original retrieval time and does not make more calls',async()=>{
  let clock=Date.parse(at),calls=0;
  const service=createResearchService({now:()=>clock,search:async()=>{calls++;return result();}});
  const input={query:'Solana launches',providers:['exa','parallel']};
  const first=await service.run(input);clock+=1000;const second=await service.run(input);
  assert.equal(calls,2);assert.equal(first.cached,false);assert.equal(second.cached,true);
  assert.equal(second.retrievedAt,first.retrievedAt);assert.equal(second.documentCount,1);assert.equal(second.executionEnabled,false);
  second.documents[0].title='Changed';assert.equal((await service.run(input)).documents[0].title,'Launch');
});
test('partial failure is explicit, isolated, and not cached as success',async()=>{
  let clock=Date.parse(at),calls=0;
  const service=createResearchService({now:()=>clock,cooldownMs:0,search:async provider=>{calls++;if(provider==='exa')throw new ResearchError('rate_limited','Free quota reached.',429);return result();}});
  const value=await service.run({query:'Solana launches',providers:['exa','parallel']});
  assert.equal(value.documentCount,1);assert.equal(value.providers[0].status,'limited');assert.equal(value.providers[1].status,'ready');
  clock++;await service.run({query:'Solana launches',providers:['exa','parallel']});assert.equal(calls,4);
});
test('unknown and null failures cannot leak bodies or break failure isolation',async()=>{
  const service=createResearchService({search:async provider=>{if(provider==='exa')throw null;throw Error('secret upstream body');}});
  const value=await service.run({query:'Solana launches',providers:['exa','parallel']});
  assert.equal(value.documentCount,0);assert.ok(value.providers.every(x=>x.status==='unavailable'&&x.error==='Reader unavailable.'));
  assert.ok(!JSON.stringify(value).includes('secret'));
});
test('single flight, cooldown, and daily budget stop repeated external requests',async()=>{
  let finish;let clock=Date.parse(at);
  const service=createResearchService({maxRuns:1,now:()=>clock,search:()=>new Promise(resolve=>finish=resolve)});
  const first=service.run({query:'Solana launches',providers:['exa']});
  await assert.rejects(service.run({query:'Other query',providers:['exa']}),{code:'busy'});
  finish(result());await first;clock+=61000;
  await assert.rejects(service.run({query:'Other query',providers:['exa']}),{code:'local_limit'});
  assert.equal(service.status().running,false);assert.equal(service.status().paidFallback,false);
});
function mockMcp({sse=false,tool='web_search_exa',toolsMissing=false}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,options,body});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    const value=body.method==='initialize'?{protocolVersion:'2025-03-26'}:body.method==='tools/list'?{tools:toolsMissing?[]:[{name:tool}]}:{content:[{type:'text',text:'No results found.'}]};
    const message={jsonrpc:'2.0',id:body.id,result:value};
    return new Response(sse?`event: message\r\ndata: ${JSON.stringify(message)}\r\n\r\n`:JSON.stringify(message),{headers:{'content-type':sse?'text/event-stream':'application/json','mcp-session-id':'fixture-session'}});
  };return {calls,fetchImpl};
}
for(const sse of [false,true])test(`MCP ${sse?'SSE':'JSON'} transport only calls the approved search tool`,async()=>{
  const mock=mockMcp({sse});await callSearch('exa','public Solana docs',{fetchImpl:mock.fetchImpl});
  assert.deepEqual(mock.calls.map(x=>x.body.method),['initialize','notifications/initialized','tools/list','tools/call']);
  assert.ok(mock.calls.every(x=>x.url===ENDPOINTS.exa.url&&x.options.redirect==='error'&&!x.options.headers.Authorization));
  assert.equal(mock.calls[3].options.headers['Mcp-Session-Id'],'fixture-session');assert.equal(mock.calls[3].body.params.name,'web_search_exa');
});
test('Parallel sends its exact request shape without an invented model identifier',async()=>{
  const mock=mockMcp({tool:'web_search'});await callSearch('parallel','public Solana docs',{fetchImpl:mock.fetchImpl});
  const args=mock.calls.at(-1).body.params.arguments;
  assert.equal(args.objective,'public Solana docs');assert.deepEqual(args.search_queries,['public Solana docs']);assert.equal(args.model_name,undefined);
});
test('MCP rejects unknown providers and missing tools without dispatching an alternative',async()=>{
  let calls=0;await assert.rejects(callSearch('toString','query',{fetchImpl:async()=>calls++}),{code:'invalid_provider'});assert.equal(calls,0);
  const mock=mockMcp({toolsMissing:true});await assert.rejects(callSearch('exa','query',{fetchImpl:mock.fetchImpl}),{code:'unsupported_tool'});assert.equal(mock.calls.length,3);
});
test('MCP enforces free quota errors, body bounds and timeouts',async()=>{
  await assert.rejects(callSearch('exa','query',{fetchImpl:async()=>new Response('private detail',{status:429})}),{code:'rate_limited'});
  await assert.rejects(callSearch('exa','query',{fetchImpl:async()=>new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})}),{code:'response_too_large'});
  const fetchImpl=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  await assert.rejects(callSearch('exa','query',{fetchImpl,timeoutMs:5}),{code:'timeout'});
});
