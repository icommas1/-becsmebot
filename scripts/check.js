const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{execFileSync}=require("node:child_process");
function check(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())check(file);
  else if(file.endsWith(".js"))new vm.Script(fs.readFileSync(file,"utf8"),{filename:file});
  else if(file.endsWith(".mjs"))execFileSync(process.execPath,["--check",file],{stdio:"pipe"});
}}
for(const dir of ["src","scripts","test"])check(dir);
new vm.Script(fs.readFileSync("playwright.config.js","utf8"),{filename:"playwright.config.js"});
const html=fs.readFileSync("src/web/dashboard.html","utf8");
const fragment=fs.readFileSync("src/web/assets/terminal-fragment.html","utf8");
const launcher=fs.readFileSync("src/web/assets/js/launch.mjs","utf8");
if(!html.includes('<script type="module" src="/assets/js/launch.mjs"></script>')||
  !launcher.includes('import("./dashboard.mjs")'))throw Error("Terminal module entry point is missing");
const ids=[...(html+fragment).matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)throw Error("Duplicate terminal element ID");
require("../src/api/validation");
require("../src/research/validation");
console.log("JavaScript, DOM IDs and strict API schemas checked");
