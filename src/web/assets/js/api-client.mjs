export function createApiClient(fetchImpl=globalThis.fetch) {
  async function call(url,options={}) {
    const response=await fetchImpl(url,{...options,credentials:"same-origin"});
    if(!response.ok) {
      const body=await response.json().catch(()=>({}));
      throw Error(body.error||"Request failed: "+response.status);
    }
    return response.json();
  }

  return Object.freeze({
    basket:()=>call("/api/basket"),
    search:query=>call("/api/search?q="+encodeURIComponent(query)),
    paperPrices:mints=>call("/api/paper/prices",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mints})
    })
  });
}
