export function createApiClient(fetchImpl=globalThis.fetch,{timeoutMs=60000}={}) {
  const conditionalCache=new Map();
  async function request(url,options,read) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      return await read(await fetchImpl(url,{...options,credentials:"same-origin",signal:controller.signal}));
    } catch(error) {
      if(controller.signal.aborted)throw Error("Market request timed out. Try refreshing.");
      throw error;
    } finally {clearTimeout(timer);}
  }
  async function call(url,options={}) {
    return request(url,options,async response=>{
      if(!response.ok) {
        const body=await response.json().catch(()=>({}));
        throw Error(body.error||"Request failed: "+response.status);
      }
      return response.json();
    });
  }
  async function conditionalGet(url,key) {
    const cached=conditionalCache.get(key),headers={};
    if(cached?.etag)headers["If-None-Match"]=cached.etag;
    return request(url,{headers},async response=>{
      if(response.status===304&&cached)return cached.value;
      if(!response.ok) {
        const body=await response.json().catch(()=>({}));
        throw Error(body.error||"Request failed: "+response.status);
      }
      const value=await response.json();
      conditionalCache.set(key,{etag:response.headers?.get?.("etag")||null,value});
      return value;
    });
  }
  const paperPrices=mints=>call("/api/paper/prices",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mints})
  });
  async function allPaperPrices(mints) {
    const prices={};
    for(let index=0;index<mints.length;index+=100) {
      const result=await paperPrices(mints.slice(index,index+100));
      Object.assign(prices,result.prices);
    }
    return prices;
  }
  return Object.freeze({
    basket:async()=>{
      const value=await conditionalGet("/api/basket","basket");
      if(!Array.isArray(value.signals))return value;
      const rows=new Map((value.radar||[]).map(row=>[row.mint,row]));
      return {...value,signals:value.signals.map(signal=>({...rows.get(signal.mint),...signal})).filter(signal=>signal.mint)};
    },
    history:()=>conditionalGet("/api/history","history"),
    search:query=>call("/api/search?q="+encodeURIComponent(query)),
    paperPrices,allPaperPrices
  });
}
