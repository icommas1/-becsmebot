const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {backupCrypt}=require('../../src/operations/backup-crypt');
test('Backup roundtrip is authenticated, owner-only, rejects damage/wrong keys and never overwrites destinations',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'becs-crypt-'));
  try{
    const input=path.join(dir,'input'),encrypted=path.join(dir,'encrypted'),restored=path.join(dir,'restored'),key=randomBytes(32),bytes=randomBytes(250000);
    await fs.writeFile(input,bytes);await backupCrypt('encrypt',input,encrypted,key);await backupCrypt('decrypt',encrypted,restored,key);
    assert.deepEqual(await fs.readFile(restored),bytes);assert.equal((await fs.stat(encrypted)).mode&0o077,0);assert.equal((await fs.stat(restored)).mode&0o077,0);
    await assert.rejects(backupCrypt('decrypt',encrypted,restored,key));
    await assert.rejects(backupCrypt('decrypt',encrypted,path.join(dir,'wrong-key'),randomBytes(32)));
    const broken=await fs.readFile(encrypted);broken[25]^=1;await fs.writeFile(encrypted,broken);
    await assert.rejects(backupCrypt('decrypt',encrypted,path.join(dir,'corrupt'),key));
    assert.equal((await fs.readdir(dir)).some(x=>x.includes('.partial-')||['wrong-key','corrupt'].includes(x)),false);
    await fs.writeFile(input,'');await backupCrypt('encrypt',input,path.join(dir,'empty.enc'),key);
    await backupCrypt('decrypt',path.join(dir,'empty.enc'),path.join(dir,'empty.out'),key);assert.equal((await fs.stat(path.join(dir,'empty.out'))).size,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
