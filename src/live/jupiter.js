const BASE="https://api.jup.ag/swap/v2";

function createJupiterLiveTransport({apiKey,fetchImpl=fetch}={}) {
  if(!apiKey)throw Error("JUPITER_API_KEY is required");
  const headers={"x-api-key":apiKey};
  return {
    async order(intent,context) {
      const params=new URLSearchParams({
        inputMint:context.inputMint,
        outputMint:context.outputMint,
        amount:String(context.inputAmount),
        taker:context.walletPublicKey
      });
      const response=await fetchImpl(BASE+"/order?"+params,{headers,signal:AbortSignal.timeout(10000)});
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data)throw Error("Jupiter order unavailable");
      return data;
    },
    async execute(payload) {
      const response=await fetchImpl(BASE+"/execute",{
        method:"POST",headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data)throw Error("Jupiter execution unavailable");
      return data;
    }
  };
}

module.exports={createJupiterLiveTransport};
