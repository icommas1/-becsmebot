// A lost response retains the SAME command until the user retries it.
// Session storage survives reloads without mixing another tab's pending action.
export function createServerPaper({fetchImpl=globalThis.fetch,storage,now=Date.now}={}) {
  let accountId=null,pending=null,busy=false;
  const key=()=>"becsServerPending:"+accountId;
  async function request(url,options={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      const res=await fetchImpl(url,{...options,credentials:"same-origin",signal:controller.signal});
      const body=await res.json();
      if(!res.ok)throw Object.assign(Error(body.error||"Server account unavailable."),{status:res.status});
      return body;
    }finally{clearTimeout(timer);}
  }
  async function read(){return request("/api/paper/account");}
  function attach(paper){accountId=paper.account.accountId;const raw=storage.getItem(key());pending=raw?JSON.parse(raw):null;}
  async function retry(){
    if(busy)throw Error("A paper action is already in progress.");
    if(!pending)throw Error("No pending action to retry.");
    busy=true;
    try{
      const result=await request("/api/paper/commands",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pending)});
      storage.removeItem(key());pending=null;return result;
    }catch(error){
      // Definitive request rejection cannot contain a committed fill.
      if([400,403,409].includes(error.status)){storage.removeItem(key());pending=null;}
      throw error;
    }finally{busy=false;}
  }
  async function send(action){
    if(pending||busy)throw Error("Resolve the pending paper action first.");
    const value={...action,requestId:crypto.randomUUID(),createdAt:new Date(now()).toISOString()};
    // Persist before any request; fail closed if reload-safe retry is unavailable.
    storage.setItem(key(),JSON.stringify(value));pending=value;return retry();
  }
  return {request,read,attach,send,retry,get pending(){return !!pending;},get busy(){return busy;}};
}
