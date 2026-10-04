const fs=require('node:fs');
const {backupCrypt}=require('../src/operations/backup-crypt');
async function main(){
  const [mode,input,output]=process.argv.slice(2),keyPath=process.env.BACKUP_KEY_FILE;
  if(!keyPath||(fs.statSync(keyPath).mode&0o077))throw Error('Owner-only backup key required');
  const key=fs.readFileSync(keyPath);
  try{await backupCrypt(mode,input,output,key);}finally{key.fill(0);}
}
if(require.main===module)main().catch(()=>{console.error('Backup encryption or authentication failed.');process.exitCode=1;});
module.exports={main};
