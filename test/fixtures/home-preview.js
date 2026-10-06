// Local, synthetic UI fixture only. Never imported by src/basket.js or deployed as a service.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const web = path.resolve(__dirname, '../../src/web');
const assets = new Map([
  ['/assets/home.css', ['assets/home.css', 'text/css']],
  ['/assets/js/home.mjs', ['assets/js/home.mjs', 'text/javascript']],
  ['/assets/js/home-model.mjs', ['assets/js/home-model.mjs', 'text/javascript']],
  ['/assets/js/home-api.mjs', ['assets/js/home-api.mjs', 'text/javascript']],
]);
function startHomePreview(port = 4175) {
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    if(req.method !== 'GET') {res.writeHead(405);res.end();return;}
    const url = new URL(req.url, 'http://127.0.0.1');
    if(url.pathname === '/home') {
      res.setHeader('Content-Type','text/html; charset=utf-8');
      const html = fs.readFileSync(path.join(web,'home.html'),'utf8').replace('<body>', '<body><div style="padding:8px 20px;text-align:center;font:10px/1.4 system-ui;letter-spacing:1px;background:#e5c381;color:#152019">LOCAL REVIEW PREVIEW · SYNTHETIC DATA · NOT PRODUCTION</div>');
      res.end(html);return;
    }
    const asset=assets.get(url.pathname);
    if(asset) {res.setHeader('Content-Type',asset[1]);res.end(fs.readFileSync(path.join(web,asset[0])));return;}
    res.setHeader('Content-Type','application/json');
    const fixtures={
      '/health':{ok:true,tradingEnabled:false,manualSell:{enabled:false},running:false,lastScanAt:new Date(Date.now()-30000).toISOString(),lastError:null,feeds:{},release:{commit:'e6ba725b4b4a4e5990d6d35389047a39931b963c'}},
      '/api/paper/capabilities':{enabled:true},
      '/api/superagent/capabilities':{enabled:false},
      '/api/auth/status':{authenticated:false},
    };
    if(Object.hasOwn(fixtures,url.pathname)) {res.end(JSON.stringify(fixtures[url.pathname]));return;}
    if(url.pathname==='/assets/becs-logo.jpg') {res.writeHead(204);res.end();return;}
    res.writeHead(404);res.end(JSON.stringify({error:'Local fixture route unavailable.'}));
  });
  server.listen(port,'127.0.0.1');return server;
}
if(require.main===module) {
  const server=startHomePreview();
  server.on('listening',()=>console.log('Synthetic local preview: http://127.0.0.1:4175/home'));
}
module.exports={startHomePreview};
