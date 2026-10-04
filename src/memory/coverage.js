const {verifyEvent}=require('../events/becs-event');
const {createHash}=require('node:crypto');
const {limits}=require('./config');
const categories=Object.freeze({'decision.evaluated':'decisions','order.intent.created':'intents',
  'paper.execution.completed':'executions','paper.settings.updated':'settings',
  'paper.cash.adjusted':'account_changes','paper.wallet.reset':'account_changes'});
// Caller supplies a checked-out connection and a server-authenticated owner only.
// Never initializes schemas, captures evidence, writes checkpoints or materializes memory.
async function memoryCoverage(client,userId,{maxEvents=limits.maxEvents,maxMillis=limits.maxMillis}={}){
  if(typeof userId!=='string'||!userId||!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>limits.maxEvents||
    !Number.isInteger(maxMillis)||maxMillis<1||maxMillis>limits.maxMillis)throw Error('Invalid coverage context');
  const streamId='paper:'+createHash('sha256').update(userId).digest('hex');
  const result={version:1,scope:'authenticated_owner_paper_events',snapshotAt:null,
    source:{status:'unavailable',retained:0,verified:0,headSequence:0,headHash:null,complete:false,categories:[],provenance:[]},
    memory:{status:'not_implemented',records:null,coveragePercent:null},
    excludedSurfaces:['browser_local_paper','human_sessions','research_archive_separate_store','rejected_commands'],
    limitations:['No memory materializer exists. Retained evidence is not memory coverage.',
      'A database head is a consistency anchor, not an independently stored backup or signature.',
      'Event strategy versions are retained; source-code freshness is unavailable in this event stream.']};
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const started=performance.now();
  try{
    await client.query(`SET LOCAL statement_timeout = '${limits.statementMs}ms'`);
    result.snapshotAt=(await client.query('SELECT transaction_timestamp() AS at')).rows[0].at.toISOString();
    const present=(await client.query("SELECT to_regclass('becs_events') IS NOT NULL AND to_regclass('becs_event_streams') IS NOT NULL AS ready")).rows[0].ready;
    if(present){
      const head=(await client.query('SELECT head_sequence,head_hash,event_count FROM becs_event_streams WHERE stream_id=$1',[streamId])).rows[0];
      const groups=(await client.query('SELECT type,count(*) AS n FROM becs_events WHERE stream_id=$1 GROUP BY type ORDER BY type LIMIT 65',[streamId])).rows;
      if(groups.length>64)throw Error('Coverage category bound exceeded');
      result.source.retained=groups.reduce((n,r)=>n+Number(r.n),0);
      result.source.categories=groups.map(r=>({eventType:r.type,category:Object.hasOwn(categories,r.type)?categories[r.type]:'unmapped',retained:Number(r.n)}));
      const versions=(await client.query('SELECT source,strategy_id,strategy_version,count(*) AS n FROM becs_events WHERE stream_id=$1 GROUP BY source,strategy_id,strategy_version ORDER BY source,strategy_id,strategy_version LIMIT 65',[streamId])).rows;
      result.source.provenance=versions.slice(0,64).map(r=>({source:r.source,strategyId:r.strategy_id,strategyVersion:r.strategy_version,records:Number(r.n)}));
      result.source.headSequence=Number(head?.head_sequence||0);result.source.headHash=head?.head_hash||null;
      let sequence=0,previous=null,valid=true;
      while(sequence<Math.min(maxEvents,result.source.retained)&&performance.now()-started<maxMillis){
        const rows=(await client.query('SELECT * FROM becs_events WHERE stream_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',
          [streamId,sequence,Math.min(limits.pageSize,maxEvents-sequence)])).rows;
        if(!rows.length){valid=false;break;}
        for(const row of rows){
          const e={schemaVersion:row.schema_version,eventId:row.event_id,streamId:row.stream_id,sequence:Number(row.sequence),
            occurredAt:Number(row.occurred_at),type:row.type,source:row.source,payload:row.payload,payloadHash:row.payload_hash,
            previousHash:row.previous_hash,eventHash:row.event_hash,requestId:row.request_id,accountId:row.account_id,
            strategy:row.strategy_id?{id:row.strategy_id,version:row.strategy_version}:null};
          if(!verifyEvent(e,{streamId,sequence:sequence+1,previousHash:previous})){valid=false;break;}
          sequence++;previous=e.eventHash;
        }
        if(!valid)break;
      }
      result.source.verified=sequence;
      const metadataValid=(head?Number(head.event_count):0)===result.source.retained&&result.source.headSequence===result.source.retained;
      const complete=sequence===result.source.retained;
      result.source.complete=valid&&metadataValid&&complete&&previous===result.source.headHash&&versions.length<=64;
      result.source.status=!valid||!metadataValid||complete&&previous!==result.source.headHash?'invalid':
        result.source.complete?(sequence?'verified':'empty'):'partial';
    }
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
module.exports={memoryCoverage,limits,categories};
