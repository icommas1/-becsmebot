const Ajv=require('ajv');
const ajv=new Ajv({strict:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false});
ajv.addSchema(require('../api/research-schemas.json'));
const validators=Object.fromEntries(['request','response','status'].map(name=>[name,ajv.compile({$ref:`becs-research#/definitions/${name}`})]));
function assertResearch(name,value){if(!validators[name]?.(value))throw Error('Research contract validation failed.');return value;}
module.exports={assertResearch,validators};
