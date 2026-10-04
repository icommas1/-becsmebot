const {test,expect}=require("@playwright/test");
const {fixtureReport}=require("../fixtures/superagent-report");
test("owner report safely displays paper evidence, references and independent pages",async({page})=>{
  let calls=0;const requested=[];
  await page.route("**/api/superagent/capabilities",route=>route.fulfill({json:{enabled:true}}));
  await page.route("**/api/superagent/report?*",route=>{
    calls++;const query=new URL(route.request().url()).searchParams;requested.push(query);
    const report=fixtureReport();
    if(calls===1){report.nextPurchaseAfter=3;report.nextOutcomeAfter={at:report.outcomes[0].observedAt,purchaseId:report.outcomes[0].purchaseId,sourceKey:report.outcomes[0].sourceKey};}
    else if(query.has("outcomeAfter")){report.outcomes[0].priceUsd=.03;report.outcomes[0].priceRatioToEntry=3;}
    else{report.purchases[0].purchaseId="33333333-3333-4333-8333-333333333333";report.purchases[0].sequence=6;}
    return route.fulfill({json:report});
  });
  await page.goto("/superagent");await expect(page.locator("#report")).toBeVisible();
  await expect(page.locator("#purchases article")).toHaveCount(1);await expect(page.locator("#outcomes article")).toHaveCount(1);
  await expect(page.locator("#purchases")).toContainText("<img src=x onerror=alert(1)>");await expect(page.locator("#purchases img")).toHaveCount(0);
  await expect(page.getByText("Learning and predictive improvement: not evaluated.",{exact:false})).toBeVisible();
  await page.locator("#purchases summary").click();await expect(page.locator("#purchases pre")).toContainText("eventHash");
  await page.locator("#more-outcomes").click();await expect(page.locator("#outcomes article")).toHaveCount(2);await expect(page.locator("#purchases article")).toHaveCount(1);
  expect(requested[1].has("outcomeAfter")).toBeTruthy();
  await page.locator("#more-purchases").click();await expect(page.locator("#purchases article")).toHaveCount(2);await expect(page.locator("#outcomes article")).toHaveCount(2);
  expect(requested[2].get("purchaseAfter")).toBe("3");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  for(const button of await page.locator("button:visible").all()){const box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);}
  expect(await page.evaluate(()=>Object.keys(localStorage).length)).toBe(0);
});
test("report handles disabled, sign-in, expiry, empty history and unavailable database without invented observations",async({page})=>{
  let enabled=false,status=401;
  await page.route("**/api/superagent/capabilities",route=>route.fulfill({json:{enabled}}));
  await page.route("**/api/superagent/report?*",route=>{const report=fixtureReport();report.purchases=[];report.outcomes=[];
    return route.fulfill({status,json:status===200?report:{error:"unavailable"}});});
  await page.goto("/superagent");await expect(page.locator("#status")).toContainText("disabled");await expect(page.locator("#report")).toBeHidden();
  enabled=true;await page.getByRole("button",{name:"Refresh report"}).click();await expect(page.getByRole("link",{name:"Sign in with GitHub"})).toBeVisible();
  status=200;await page.getByRole("button",{name:"Refresh report"}).click();await expect(page.locator("#purchases-empty")).toBeVisible();await expect(page.locator("#outcomes-empty")).toBeVisible();
  status=503;await page.getByRole("button",{name:"Refresh report"}).click();await expect(page.locator("#status")).toContainText("unavailable");await expect(page.locator("#report")).toBeHidden();
  status=200;await page.getByRole("button",{name:"Refresh report"}).click();await expect(page.locator("#report")).toBeVisible();
  status=401;await page.getByRole("button",{name:"Refresh report"}).click();await expect(page.locator("#report")).toBeHidden();await expect(page.locator("#coverage")).toBeEmpty();
});
