export function createApiClient(fetchImpl=globalThis.fetch) {
  async function call(url,options={}) {
    const response=await fetchImpl(url,{...options,credentials:"same-origin"});
    if(!response.ok) {
      const body=await response.json().catch(()=>({}));
      throw Error(body.error||"Request failed: "+response.status);
    }
    return response.json();
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
    basket:()=>call("/api/basket"),
    search:query=>call("/api/search?q="+encodeURIComponent(query)),
    paperPrices,allPaperPrices
  });
}
