function createProofProvider({id,prove,verify}){
  if(typeof id!=="string"||!id||typeof prove!=="function"||typeof verify!=="function")throw Error("Invalid proof provider");
  return Object.freeze({id,prove,verify});
}
module.exports={createProofProvider};
