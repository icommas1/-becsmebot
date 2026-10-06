const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

// Narrow route-registration check. The existing integration/e2e server exercises
// real Express; this unit test deliberately does not initialize accounts or stores.
function registeredRoutes(){
  const routes=[],middleware=[];
  const app={set(){},disable(){},get(route,handler){routes.push({route,handler});},use(...args){middleware.push(args);},post(){}};
  const express=()=>app;express.json=()=>()=>{};express.static=()=>()=>{};
  const mocks={express,'./validation':{assertSchema:(_name,value)=>value,isValid:()=>true},
    '../research/routes':{mountResearchRoutes(){}},'../paper/routes':{mountPaperRoutes(){}},'../superagent/routes':{mountReportRoutes(){}}};
  const filename=path.resolve(__dirname,'../../src/api/app.js');const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,__dirname:path.dirname(filename),require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name)});
  module.exports.createApp({}, {config:{enabled:false}}, {}, ()=>({}));
  return {routes,middleware};
}
test('home is additive and the original root/terminal routes still serve the original shell',()=>{
  const {routes}=registeredRoutes();
  for(const [route,suffix] of [['/home','/web/home.html'],['/terminal','/web/dashboard.html'],['/','/web/dashboard.html'],['/superagent','/web/superagent.html'],['/memory','/web/memory.html']]){
    const found=routes.find(item=>Array.isArray(item.route)?item.route.includes(route):item.route===route);assert.ok(found,route);
    let target;found.handler({}, {sendFile:file=>{target=file;}});assert.ok(target.endsWith(suffix),target);
  }
});
test('home inherits no-store and same-origin security; markup contains no embedded private records',()=>{
  const {middleware}=registeredRoutes();let headers;
  for(const [fn] of middleware)if(typeof fn==='function'&&fn.length===3)fn({}, {set:value=>{headers=value;}},()=>{});
  assert.equal(headers['Cache-Control'],'no-store');assert.match(headers['Content-Security-Policy'],/connect-src 'self'/);
  const html=fs.readFileSync(path.resolve(__dirname,'../../src/web/home.html'),'utf8');
  assert.match(html,/src="\/assets\/js\/home.mjs"/);assert.doesNotMatch(html,/on(?:click|load|submit)\s*=/i);
  assert.doesNotMatch(html,/fixture-event|eventHash|accountId|payload/);
});
