const archiveIntervals=Object.freeze({retryMs:10000,catchupMs:1000});
function archiveConfig(env=process.env){
  const enabled=String(env.RESEARCH_ARCHIVE_ENABLED||"").toLowerCase()==="true";
  const databaseUrl=(env.RESEARCH_ARCHIVE_DATABASE_URL||env.DATABASE_URL||"").trim();
  const streamId=(env.RESEARCH_ARCHIVE_STREAM_ID||"becs-research-v1").trim();
  if(enabled&&!databaseUrl)throw Error("RESEARCH_ARCHIVE_ENABLED requires RESEARCH_ARCHIVE_DATABASE_URL or DATABASE_URL");
  if(!/^[a-zA-Z0-9:_-]{1,120}$/.test(streamId))throw Error("RESEARCH_ARCHIVE_STREAM_ID is invalid");
  return {enabled,databaseUrl:databaseUrl||null,streamId};
}
module.exports={archiveConfig,archiveIntervals};
