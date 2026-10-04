const {readFileSync}=require("node:fs");
const {createHash,randomUUID}=require("node:crypto");
const path=require("node:path");
const {digest}=require("../events/becs-event");
const {FEEDS}=require("../market/tokens");
const {DEX_FEEDS}=require("../market/dexscreener");
const {SCHEMA_VERSION,ENCODING}=require("./store");
const {archiveIntervals,archiveLimits}=require("./config");

const sourceFiles=[
  "package.json","package-lock.json",
  "src/basket.js","src/market/market.js","src/market/tokens.js","src/market/signals.js",
  "src/market/client.js","src/market/dexscreener.js","src/market/history.js","src/market/mint.js",
  "src/intel/wallet-intel.js","src/paper/service.js","src/paper/store.js",
  "src/paper/config.js","src/paper/routes.js","src/paper/schema.sql","src/api/app.js","src/api/validation.js",
  "src/events/becs-event.js","src/archive/store.js","src/archive/capture.js",
  "src/archive/config.js","src/proof/provider.js","src/proof/local-hash.js",
  "src/archive/runtime-evidence.js","src/archive/schema.sql","src/api/schemas.json",
  "src/web/assets/js/filters.mjs","src/web/assets/js/paper-wallet.mjs",
  "src/web/assets/js/trading/contracts.mjs","src/web/assets/js/trading/decision-engine.mjs",
  "src/web/assets/js/trading/paper-executor.mjs","src/web/assets/js/trading/paper-pipeline.mjs","src/web/assets/js/core.mjs"
];
function sourceHashes(){
  const root=path.resolve(__dirname,"../..");
  return Object.fromEntries(sourceFiles.map(file=>[file,createHash("sha256").update(readFileSync(path.join(root,file))).digest("hex")]));
}

// Explicit allowlist only. Never enumerate process.env or serialize account/provider config objects.
async function runtimeEvidence({env,marketScanMs,walletIntelEnabled,walletIntelScanMs,paperAccountsEnabled,streamId}){
  const [{paperDefaults},{currentStrategy}]=await Promise.all([
    import("../web/assets/js/paper-wallet.mjs"),import("../web/assets/js/trading/contracts.mjs")
  ]);
  const configuration={marketScanMs,walletIntel:{enabled:walletIntelEnabled,scanMs:walletIntelScanMs,provider:"nansen"},
    paperAccountsEnabled,strategy:{...currentStrategy},paperDefaults:{...paperDefaults},
    marketFeeds:{jupiter:FEEDS,dexscreener:DEX_FEEDS},archive:{streamId,schemaVersion:SCHEMA_VERSION,encoding:ENCODING,...archiveIntervals,limits:archiveLimits}};
  const sources=sourceHashes(),codeHash=digest(sources);
  const commit=/^[0-9a-f]{40}$/i.test(env.RAILWAY_GIT_COMMIT_SHA||"")?env.RAILWAY_GIT_COMMIT_SHA.toLowerCase():null;
  const payload={schemaVersion:2,runtimeId:randomUUID(),tradingEnabled:false,marketScanMs,walletIntelEnabled,walletIntelScanMs,
    build:{commit,codeHash,sources,nodeVersion:process.versions.node,packageVersion:require("../../package.json").version},
    configuration,configurationHash:digest(configuration)};
  const reference={runtimeId:payload.runtimeId,commit,codeHash,configurationHash:payload.configurationHash,evidenceHash:digest(payload)};
  return {payload,reference};
}
module.exports={runtimeEvidence,sourceHashes};
