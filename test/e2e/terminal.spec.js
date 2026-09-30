const { test, expect }=require("@playwright/test");
const { MINTS }=require("../fixtures/market");
test.beforeEach(async({page})=>{
  await page.goto("/");
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
});
test("fresh filters, radar and responsive execution dock",async({page,isMobile})=>{
  await expect(page.locator("#radar")).toContainText("FRESH");
  await expect(page.locator("#radar")).not.toContainText(/LARGE|OLD|RISK/);
  await expect(page.locator("#radar-map .radar-blip")).toHaveCount(2);
  await expect(page.locator("#dock-buy")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(isMobile){
    const dock=await page.locator("#dock-buy").boundingBox();
    expect(dock.height).toBeGreaterThanOrEqual(44);
    expect(dock.x).toBeGreaterThanOrEqual(0);
    expect(dock.x+dock.width).toBeLessThanOrEqual(page.viewportSize().width);
    const nav=await page.locator(".view-nav").boundingBox();
    const execution=await page.locator(".execution-dock").boundingBox();
    expect(nav.y+nav.height).toBeGreaterThanOrEqual(page.viewportSize().height-2);
    expect(execution.y+execution.height).toBeLessThanOrEqual(nav.y+1);
    expect(await page.locator("#radar").evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    await page.getByRole("button",{name:"Signals",exact:true}).click();
    await expect(page.locator("#signals")).toContainText("FRESH");
  }
});
test("all terminal navigation panels remain reachable",async({page})=>{
  for(const [button,view,content] of [
    ["Markets","radar","FRESH"],["Paper wallet","paper","Paper wallet"],
    ["Activity","activity","Paper activity"],["Settings","settings","Paper & display settings"],
    ["Signals","signals","FRESH"],["Feeds","connections","Data feeds"]
  ]){
    await page.getByRole("button",{name:button,exact:true}).click();
    await expect(page.locator("body")).toHaveAttribute("data-view",view);
    if(view==="radar")await expect(page.locator("#radar")).toContainText(content);
    else if(view==="signals")await expect(page.locator("#signals")).toContainText(content);
    else await expect(page.locator(`[data-view-panel="${view}"]`)).toContainText(content);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("token details expose the correct CA and dollar controls",async({page,isMobile})=>{
  await page.locator("#radar").getByRole("button",{name:"FRESH",exact:true}).click();
  if(!isMobile)await page.locator("#dock-token").click();
  const sheet=page.locator("#token-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(MINTS[0]);
  await expect(sheet.getByRole("link",{name:"Dex Screener"})).toHaveAttribute("href","https://dexscreener.com/solana/"+MINTS[0]);
  await page.getByRole("button",{name:"Close token details"}).click();
  await page.locator("#dock-sizes").getByRole("button",{name:"$5",exact:true}).click();
  await expect(page.locator("#dock-buy")).toHaveText("BUY $5");
  await page.locator("#dock-sizes").getByRole("button",{name:"$1",exact:true}).click();
  await expect(page.locator("#dock-buy")).toHaveText("BUY $1");
});
test("one dollar paper buy and sale survive a reload without real orders",async({page,isMobile})=>{
  const realRequests=[];
  page.on("request",r=>{if(r.url().includes("/api/sell"))realRequests.push(r.url());});
  await page.locator("#radar").getByRole("button",{name:"FRESH",exact:true}).click();
  if(isMobile)await page.getByRole("button",{name:"Close token details"}).click();
  await page.locator("#dock-buy").click();
  let wallet=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  expect(wallet.holds[MINTS[0]].investedUsd).toBe(1);
  expect(wallet.cashSol).toBeCloseTo(.394995,8);
  await page.reload();
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await page.locator("#radar").getByRole("button",{name:"FRESH",exact:true}).click();
  if(isMobile)await page.getByRole("button",{name:"Close token details"}).click();
  await expect(page.locator("#dock-sell")).toBeEnabled();
  await page.locator("#dock-sell").click();
  wallet=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  expect(wallet.holds[MINTS[0]].qty).toBeCloseTo(50,8);
  expect(wallet.activity[0].sizeUsd).toBe(1);
  expect(wallet.auto).toBe(false);
  expect(realRequests).toEqual([]);
});
test("automatic paper uses the same fresh filters and buys each mint once",async({page})=>{
  await page.getByRole("button",{name:"Paper wallet",exact:true}).click();
  await page.locator("#auto").click();
  await expect.poll(()=>page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem("becsPaperV1")).holds).length)).toBe(2);
  let wallet=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  expect(Object.values(wallet.holds).map(h=>h.investedUsd)).toEqual([1,1]);
  await page.getByRole("button",{name:"Refresh data"}).click();
  wallet=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  expect(wallet.activity.filter(a=>a.kind==="buy")).toHaveLength(2);
});
test("logo opens and reduced motion disables the scanning animation",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  expect(await page.locator(".radar-map").evaluate(el=>getComputedStyle(el,"::before").animationName)).toBe("none");
  await page.getByRole("button",{name:"View BecsBot logo"}).click();
  const logo=page.getByRole("dialog",{name:"BecsBot",exact:true});
  await expect(logo).toBeVisible();
  expect(await logo.locator("img").evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
  await page.getByRole("button",{name:"Close BecsBot logo"}).click();
  await expect(logo).not.toBeVisible();
});
