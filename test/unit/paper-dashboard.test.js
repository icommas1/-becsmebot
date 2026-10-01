const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

test("dashboard is loaded as self-hosted modules and keeps a paper-only boundary",()=>{
  const html=fs.readFileSync(require.resolve("../../src/web/dashboard.html"),"utf8");
  const fragment=fs.readFileSync(require.resolve("../../src/web/assets/terminal-fragment.html"),"utf8");
  const launcher=fs.readFileSync(require.resolve("../../src/web/assets/js/launch.mjs"),"utf8");
  const runtime=fs.readFileSync(require.resolve("../../src/web/assets/js/dashboard.mjs"),"utf8");
  assert.match(html,/<script type="module" src="\/assets\/js\/launch\.mjs"><\/script>/);
  assert.doesNotMatch(html,/Fresh launches|Dex profiles|Paper wallet/);
  assert.match(fragment,/id="radar-panel"/);
  assert.match(launcher,/import\("\.\/dashboard\.mjs"\)/);
  assert.doesNotMatch(html,/<script>([\s\S]*?)<\/script>/);
  assert.match(runtime,/from "\.\/radar-view\.mjs"/);
  assert.match(runtime,/from "\.\/paper-view\.mjs"/);
  assert.doesNotMatch(runtime,/\/api\/sell|\/api\/pause|privateKey|seedPhrase|signTransaction/i);
});
