const bs58=require("bs58").default;
function isCanonicalMint(value){
  if(typeof value!=="string"||value.length<32||value.length>44)return false;
  try{const bytes=bs58.decode(value);return bytes.length===32&&bs58.encode(bytes)===value;}catch{return false;}
}
module.exports={isCanonicalMint};
