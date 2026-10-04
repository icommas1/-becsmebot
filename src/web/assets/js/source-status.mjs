import {validStatusPayload} from './source-catalog.mjs';

// /health/archive deliberately returns 503 with a validated unhealthy report.
// That is different from an unreachable endpoint or an arbitrary HTTP failure.
export async function readStatusResponse(key,response) {
  const degradedArchive=key==='archive'&&response.status===503;
  if((!response.ok&&!degradedArchive)||!response.headers.get('content-type')?.includes('application/json')) {
    throw Error('Status unavailable');
  }
  const value=await response.json();
  if(!validStatusPayload(key,value)||(degradedArchive&&(value.enabled!==true||value.healthy!==false))) {
    throw Error('Invalid status');
  }
  return value;
}
