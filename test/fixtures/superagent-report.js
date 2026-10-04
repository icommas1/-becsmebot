const {MINTS}=require("./market");
const {CONTRACT_REVISION}=require("../../src/superagent/config");
const purchaseId="11111111-1111-4111-8111-111111111111",recordId="22222222-2222-4222-8222-222222222222",at=1791128800000;
const reference={kind:"becs-event",streamId:"paper:fixture",sequence:3,eventId:purchaseId,eventHash:"a".repeat(64),payloadHash:"b".repeat(64),schemaVersion:1};
function fixtureReport(){return {
  schemaVersion:1,scope:{sourceId:"fixture-source",ownerId:"github:123",accountId:"paper-fixture",executionMode:"paper",archiveStream:"fixture-archive",contractRevision:CONTRACT_REVISION},
  sourceVerification:"hash consistency and continuity; not external attestation",
  coverage:{eventVerifiedThrough:3,archiveVerifiedThrough:1,currentSourceHeads:"not queried by this report",retention:"append-only; no automatic pruning",browserLocalTrades:"not ingested"},
  purchases:[{purchaseId,sequence:3,asset:MINTS[0],side:"buy",occurredAt:at,executionMode:"paper",classification:"recorded-paper-purchase",
    strategy:{id:"paper-terminal",version:"1"},decision:{side:"buy",reason:"<img src=x onerror=alert(1)>",source:"fixture",automatic:false},
    fill:{intentId:"fixture-request",executionMode:"paper",status:"filled",filledQuantity:100,filledQuoteQuantity:1,fillPrice:.01,fees:{amount:.0025,currency:"USD"},createdAt:new Date(at).toISOString(),completedAt:new Date(at).toISOString()},
    references:[{...reference,sequence:1},{...reference,sequence:2},reference]}],
  outcomes:[{purchaseId,sourceKey:"archive:"+recordId,asset:MINTS[0],executionMode:"paper",classification:"observed-market-mark",priceUsd:.02,observedAt:at+1,priceFeed:"fixture",priceRatioToEntry:2,
    meaning:"sampled market price versus recorded fill; not a realized return or executable quote",
    reference:{kind:"research-archive",streamId:"fixture-archive",sequence:1,recordId,recordHash:"c".repeat(64),payloadHash:"d".repeat(64),metadataHash:"e".repeat(64),schemaVersion:1}}],
  nextPurchaseAfter:null,nextOutcomeAfter:null,hypotheses:[],learning:"not evaluated",predictiveImprovement:"not evaluated"
};}
module.exports={fixtureReport};
