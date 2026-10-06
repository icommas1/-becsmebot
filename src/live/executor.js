function rejected(intent,reason,message) {
  return {intentId:intent?.intentId||null,executionMode:"live",status:"rejected",reason,message,
    signature:null,requestId:null,createdAt:intent?.createdAt||null,completedAt:new Date().toISOString()};
}

function createLiveExecutor({guard,order,sign,execute}={}) {
  if(!guard||typeof guard.check!=="function"||typeof guard.remember!=="function")throw Error("LiveExecutionGuard is required");
  if(typeof order!=="function"||typeof sign!=="function"||typeof execute!=="function")throw Error("Live executor adapters are required");

  return {
    async execute(intent,context) {
      const allowed=guard.check(intent,context);
      if(!allowed.ok)return allowed.duplicateResult?structuredClone(allowed.duplicateResult):
        rejected(intent,allowed.reason,allowed.message);
      try {
        const quote=await order(intent,context);
        if(!quote?.transaction||!quote?.requestId)throw Error("Jupiter order unavailable");
        const signedTransaction=await sign(quote.transaction,{intent,context});
        if(typeof signedTransaction!=="string"||!signedTransaction)throw Error("Transaction signing unavailable");
        const response=await execute({signedTransaction,requestId:quote.requestId},{intent,context});
        const success=response?.status==="Success";
        const result={intentId:intent.intentId,executionMode:"live",status:success?"filled":"rejected",
          reason:success?null:"provider-rejected",message:success?null:(response?.error||"Jupiter execution failed"),
          signature:typeof response?.signature==="string"?response.signature:null,requestId:quote.requestId,
          createdAt:intent.createdAt,completedAt:new Date().toISOString()};
        if(success)guard.remember(intent,result);
        return result;
      } catch(error) {
        return rejected(intent,"execution-error",error.message);
      }
    }
  };
}

module.exports={createLiveExecutor};
