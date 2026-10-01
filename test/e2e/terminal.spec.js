const { test, expect }=require("@playwright/test");
const { MINTS }=require("../fixtures/market");
test.beforeEach(async({page})=>{
  await page.goto("/");
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
});
test("lean launch route hydrates the full terminal",async({page})=>{
  const response=await page.request.get("/terminal");
  expect(response.ok()).toBe(true);
  const shell=await response.text();
  expect(shell).not.toContain("Fresh launches");
  expect(shell).toContain("/assets/js/launch.mjs");
  await page.goto("/terminal");
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await expect(page.locator("#radar-tabs button").filter({hasText:"Dex paid ads"})).toBeVisible();
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
test("launch filters update Radar and Signals together",async({page})=>{
  await page.locator(".radar-filters summary").click();
  const liquidity=page.getByLabel("Min liquidity ($)");
  await liquidity.fill("20000");
  await liquidity.blur();
  await expect(page.locator("#radar .token-contact")).toHaveCount(0);
  await expect(page.locator("#signals .rail-contact")).toHaveCount(0);
  await page.getByRole("button",{name:"Restore fresh-launch filters"}).click();
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await expect(page.locator("#signals .rail-contact")).toHaveCount(2);
});
test("unchanged refreshes revalidate the basket without refetching chart history",async({page})=>{
  const responses=[],basketRequests=[],historyRequests=[];
  page.on("response",response=>{if(response.url().endsWith("/api/basket"))responses.push(response);});
  page.on("request",request=>{
    if(request.url().endsWith("/api/basket"))basketRequests.push(request);
    if(request.url().endsWith("/api/history"))historyRequests.push(request);
  });
  await page.locator("#refresh").click();
  await expect.poll(()=>responses.length).toBeGreaterThan(0);
  expect(basketRequests).toHaveLength(1);
  expect(basketRequests[0].headers()["if-none-match"]).toMatch(/^W\/"basket-/);
  expect(responses[0].headers()["content-length"]).toBeUndefined();
  expect(responses[0].status()).toBeLessThan(400);
  expect(historyRequests).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
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
  const account=wallet.account;
  expect(account.executionMode).toBe("paper");
  expect(account.userId).not.toBe(account.accountId);
  await page.reload();
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await page.locator("#radar").getByRole("button",{name:"FRESH",exact:true}).click();
  if(isMobile)await page.getByRole("button",{name:"Close token details"}).click();
  await expect(page.locator("#dock-sell")).toBeEnabled();
  await page.locator("#dock-sell").click();
  wallet=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  expect(wallet.account).toEqual(account);
  expect(wallet.holds[MINTS[0]].qty).toBeCloseTo(50,8);
  expect(wallet.activity[0].sizeUsd).toBe(1);
  expect(wallet.auto).toBe(false);
  await page.getByRole("button",{name:"Activity",exact:true}).click();
  await expect(page.locator("#activity")).toContainText("Paper sold $1.00 FRESH");
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
test("automatic target exits sell one dollar once and retain ownership on reload",async({page})=>{
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  const target=page.locator('[data-setting="exitMultiple"]');
  await target.fill("2");await target.blur();
  await page.getByRole("button",{name:"Paper wallet",exact:true}).click();
  await page.locator("#auto").click();
  await page.getByRole("button",{name:"Refresh data"}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")).activity.filter(a=>a.kind==="sell").length)).toBe(2);
  const wallet=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  for(const hold of Object.values(wallet.holds)) {
    expect(hold.qty).toBeCloseTo(50,8);expect(hold.autoExited).toBe(true);
  }
  expect(wallet.activity.filter(a=>a.kind==="sell").map(a=>a.sizeUsd)).toEqual([1,1]);
  await page.getByRole("button",{name:"Refresh data"}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")).activity.filter(a=>a.kind==="sell").length)).toBe(2);
  await page.reload();
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")).auto)).toBe(false);
  const reloaded=await page.evaluate(()=>JSON.parse(localStorage.getItem("becsPaperV1")));
  expect(reloaded.account).toEqual(wallet.account);expect(reloaded.auto).toBe(false);
  expect(Object.values(reloaded.holds).every(hold=>hold.autoExited)).toBe(true);
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

test("blocked browser storage still allows market browsing and reports unsaved settings",async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,"localStorage",{
    configurable:true,get(){throw new DOMException("Storage blocked","SecurityError");}
  }));
  await page.reload();
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.locator('[data-setting="betUsd"]').fill("2");
  await page.locator('[data-setting="betUsd"]').blur();
  await expect(page.locator("#message")).toContainText(/storage.*(unavailable|full)|not persist/i);
  await page.getByRole("button",{name:"Markets",exact:true}).click();
  await expect(page.locator("#radar .token-contact")).toHaveCount(2);
});

test("search failures are visible and a later successful search recovers",async({page})=>{
  await page.route("**/api/search?**",async route=>{
    if(new URL(route.request().url()).searchParams.get("q")==="unavailable")
      await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Market data temporarily unavailable"})});
    else await route.continue();
  });
  await page.locator("#radar-search").fill("unavailable");
  await expect(page.locator("#radar")).toContainText("Search: Market data temporarily unavailable");
  await page.locator("#radar-search").fill("FRESH");
  await expect(page.locator("#radar")).toContainText("FRESH");
  await expect(page.locator("#radar")).not.toContainText("temporarily unavailable");
});

test("Dex paid source selection filters Radar and Signals, survives reload and scopes auto buys",async({page})=>{
 await page.getByRole("button",{name:"Dex top boosts (paid)",exact:true}).click();
 await expect(page.locator("#radar-source")).toBeDisabled();
 await expect(page.locator("#radar .token-contact")).toHaveCount(1);
 await expect(page.locator("#radar")).toContainText("HEAT");
 await expect(page.locator("#signals .rail-contact")).toHaveCount(1);
 await page.reload();
 await expect(page.getByRole("button",{name:"Dex top boosts (paid)",exact:true})).toHaveAttribute("aria-pressed","true");
 await expect(page.locator("#radar .token-contact")).toHaveCount(1);
 await page.getByRole("button",{name:"Paper wallet",exact:true}).click();
 await page.getByRole("button",{name:"Start auto paper",exact:true}).click();
 await expect(page.locator("#paper-holds")).toContainText("HEAT");
 await expect(page.locator("#paper-holds")).not.toContainText("FRESH");
});

test("mobile refresh preserves the swiped card and panel position",async({page,isMobile})=>{
 test.skip(!isMobile,"Horizontal contacts apply to mobile layouts");
 const deck=page.locator("#radar"),panel=page.locator(".radar-panel");
 await deck.locator(".token-contact").nth(1).evaluate(el=>el.scrollIntoView({block:"nearest",inline:"start"}));
 await expect.poll(()=>deck.evaluate(el=>el.scrollLeft)).toBeGreaterThan(10);
 const before=await deck.evaluate(el=>el.scrollLeft),top=await panel.evaluate(el=>el.scrollTop);
 const response=page.waitForResponse(r=>r.url().endsWith("/api/basket"));
 // Dispatching the page's normal refresh event avoids scrolling to its offscreen header.
 await page.locator("#refresh").evaluate(el=>el.click());await response;
 await expect(page.locator("#refresh")).toBeEnabled();
 await expect.poll(async()=>Math.abs(await deck.evaluate(el=>el.scrollLeft)-before)).toBeLessThanOrEqual(2);
 await expect.poll(async()=>Math.abs(await panel.evaluate(el=>el.scrollTop)-top)).toBeLessThanOrEqual(2);
 // A launch inserted between the first and viewed token must keep that token in view.
 const payload=await(await page.request.get("/api/basket")).json();
 const between=(Date.parse(payload.radar.find(row=>row.mint===MINTS[0]).createdAt)+
   Date.parse(payload.radar.find(row=>row.mint===MINTS[1]).createdAt))/2;
 payload.radar=payload.radar.map(row=>row.mint===MINTS[2]?{...row,marketCap:50000,
   createdAt:new Date(between).toISOString()}:row);
 payload.lastScanAt=new Date().toISOString();
 const heat=deck.locator('[data-mint="'+MINTS[1]+'"]');
 const offset=await heat.evaluate(el=>el.getBoundingClientRect().left-el.parentElement.getBoundingClientRect().left);
 await page.route("**/api/basket",route=>route.fulfill({json:payload}));
 const changed=page.waitForResponse(r=>r.url().endsWith("/api/basket"));
 await page.locator("#refresh").evaluate(el=>el.click());await changed;
 await expect(page.locator("#refresh")).toBeEnabled();
 await expect(deck.locator(".token-contact")).toHaveCount(3);
 await expect.poll(async()=>Math.abs(await heat.evaluate(el=>el.getBoundingClientRect().left-el.parentElement.getBoundingClientRect().left)-offset)).toBeLessThanOrEqual(2);
 await page.getByRole("button",{name:"Dex profiles",exact:true}).click();
 await expect.poll(()=>deck.evaluate(el=>el.scrollLeft)).toBe(0);
});
test("mobile token details close reliably after refresh and dismiss on the backdrop",async({page,isMobile})=>{
 test.skip(!isMobile,"Bottom sheets apply to mobile layouts");
 await page.locator("#radar").getByRole("button",{name:"HEAT",exact:true}).click();
 const sheet=page.locator("#token-sheet");await expect(sheet).toBeVisible();
 await sheet.evaluate(el=>{el.style.maxHeight="240px";el.scrollTop=100;});
 const sheetTop=await sheet.evaluate(el=>el.scrollTop);
 expect(sheetTop).toBeGreaterThan(0);
 const response=page.waitForResponse(r=>r.url().endsWith("/api/basket"));
 await page.locator("#refresh").evaluate(el=>el.click());await response;
 await expect(page.locator("#refresh")).toBeEnabled();
 await expect.poll(()=>sheet.evaluate(el=>el.scrollTop)).toBeCloseTo(sheetTop,0);
 await page.getByRole("button",{name:"Close token details",exact:true}).click();
 await expect(sheet).not.toBeVisible();await expect(page.locator("#dock-token")).toBeFocused();
 await page.locator("#dock-token").click();await expect(sheet).toBeVisible();
 const bounds=await sheet.boundingBox();
 await page.mouse.click(10,Math.max(1,bounds.y-20));
 await expect(sheet).not.toBeVisible();await expect(page.locator("#dock-token")).toBeFocused();
 await page.locator("#radar").getByRole("button",{name:"FRESH",exact:true}).click();
 await expect(sheet).toBeVisible();await expect.poll(()=>sheet.evaluate(el=>el.scrollTop)).toBe(0);
 await page.getByRole("button",{name:"Close token details",exact:true}).click();
});
