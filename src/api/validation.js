const Ajv = require("ajv");
const { PublicKey } = require("@solana/web3.js");
const schemas = require("./schemas.json");
const ajv = new Ajv({ strict: true, allErrors: false });
ajv.addFormat("solana-mint", value => {
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
});
ajv.addFormat("date-time", value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
const validators = Object.fromEntries(Object.keys(schemas.definitions).map(name => [name,
  ajv.compile({ ...schemas, $ref: "#/definitions/" + name })]));
function isValid(name, data) {
  if (!validators[name]) throw new Error("Unknown API schema: " + name);
  return validators[name](data);
}
function assertSchema(name, data) {
  if (!isValid(name, data)) {
    const error = new Error("Invalid " + name + " data");
    error.status = 503;
    throw error;
  }
  return data;
}
module.exports = { isValid, assertSchema };
