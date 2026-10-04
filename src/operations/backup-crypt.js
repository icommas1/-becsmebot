const fs=require('node:fs'),path=require('node:path');
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const MAGIC=Buffer.from('BECSBAK1');
async function backupCrypt(mode,input,output,key){
  if(!['encrypt','decrypt'].includes(mode)||!Buffer.isBuffer(key)||key.length!==32||path.resolve(input)===path.resolve(output))throw Error('Invalid backup arguments');
  const temp=output+'.partial-'+randomBytes(12).toString('hex');
  const handle=await fs.promises.open(temp,'wx',0o600);
  try{
    if(mode==='encrypt'){
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);
      await handle.write(Buffer.concat([MAGIC,iv]));await handle.close();
      await pipeline(fs.createReadStream(input),cipher,fs.createWriteStream(temp,{flags:'a',mode:0o600}));
      await fs.promises.appendFile(temp,cipher.getAuthTag());
    }else{
      await handle.close();
      const source=await fs.promises.open(input,'r');let header,tag,size;
      try{
        size=(await source.stat()).size;if(size<36)throw Error('Invalid encrypted backup');
        header=Buffer.alloc(20);tag=Buffer.alloc(16);await source.read(header,0,20,0);await source.read(tag,0,16,size-16);
      }finally{await source.close();}
      if(!header.subarray(0,8).equals(MAGIC))throw Error('Invalid backup format');
      const cipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));cipher.setAAD(MAGIC);cipher.setAuthTag(tag);
      if(size===36){cipher.final();}
      else await pipeline(fs.createReadStream(input,{start:20,end:size-17}),cipher,fs.createWriteStream(temp,{flags:'w',mode:0o600}));
    }
    const complete=await fs.promises.open(temp,'r');try{await complete.sync();}finally{await complete.close();}
    // link is atomic and refuses to overwrite any destination, including symlinks.
    await fs.promises.link(temp,output);
    const directory=await fs.promises.open(path.dirname(path.resolve(output)),'r');try{await directory.sync();}finally{await directory.close();}
  }finally{await handle.close().catch(()=>{});await fs.promises.unlink(temp).catch(()=>{});}
}
module.exports={backupCrypt};
