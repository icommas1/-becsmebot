const {test,expect}=require("@playwright/test");
const {fixtureMarket,MINTS}=require("../fixtures/market");
const {createPaperService}=require("../../src/paper/service");
test("server paper retry survives reload without overwriting the local wallet",async({page})=>{
  const {freshPaper}=await import("../../src/web/assets/js/paper-wallet.mjs");
  const paper=freshPaper();paper.account={userId:"fixture-owner",accountId:"fixture-server",executionMode:"paper"};
  let revision=0,loseResponse=true;const receipts=new Map(),requests=[];
  const service=createPaperService({market:await fixtureMarket(),store:{command:async(_user,input,_fingerprint,fn)=>{
    if(receipts.has(input.requestId))return {...receipts.get(input.requestId),paper,revision,replayed:true};
    const result=await fn(paper);if(result.ok){revision++;receipts.set(input.requestId,result);}return {...result,paper,revision};
  }}});
  await page.goto("/");await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  // Existing browser data must survive the opt-in server account.
  await page.evaluate(()=>localStorage.setItem("becsPaperV1",JSON.stringify({cashSol:.75,holds:{},bought:{},settings:{},activity:[]})));
  const local=await page.evaluate(()=>localStorage.getItem("becsPaperV1"));
  await page.route("**/api/paper/capabilities",r=>r.fulfill({json:{enabled:true}}));
  await page.route("**/api/auth/status",r=>r.fulfill({json:{authenticated:true}}));
  await page.route("**/api/paper/account",r=>r.fulfill({json:{paper,revision}}));
  await page.route("**/api/paper/commands",async r=>{
    const input=r.request().postDataJSON();requests.push(input);
    const result=await service.command(paper.account.userId,input);
    if(loseResponse){loseResponse=false;return r.abort("failed");}
    return r.fulfill({json:result});
  });
  await page.reload();await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await page.locator("#radar .token-contact").first().getByRole("button",{name:"BUY $1",exact:true}).click();
  await expect(page.locator("#toast")).toContainText("Retry pending action");
  expect(paper.holds[MINTS[0]].qty).toBeGreaterThan(0);expect(revision).toBe(1);
  await page.reload();await expect(page.locator("#radar .token-contact")).toHaveCount(2);
  await page.getByRole("button",{name:"Paper wallet",exact:true}).click();
  await expect(page.locator("#account-status")).toContainText("Server paper account");
  await page.locator("#retry-paper").click();await expect(page.locator("#retry-paper")).toBeHidden();
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(revision).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem("becsPaperV1"))).toBe(local);
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByLabel("Paper buy ($)").fill("5");await page.getByLabel("Paper buy ($)").blur();
  await expect.poll(()=>paper.settings.betUsd).toBe(5);
  expect(requests[2].revision).toBe(1);expect(revision).toBe(2);
});
