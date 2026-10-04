// Research limits are operational controls, separate from trading strategy.
const limits=Object.freeze({requestTimeoutMs:25000,responseBytes:1048576,maxRuns:12,cooldownMs:60000,
  cacheMs:600000,cacheBatches:12,documentsPerReader:6,providerRows:30,clientTimeoutMs:45000,
  recipeCount:10,recipeBytes:65536,nameMax:48,queryMin:3,queryMax:240});
module.exports={limits};
