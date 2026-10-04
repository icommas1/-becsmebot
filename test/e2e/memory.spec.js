const {test,expect}=require("@playwright/test");
test("memory evidence distinguishes verified, partial and invalid history and clears after auth expires",async({page})=>{
  let status=401,state="verified";
  await page.route("**/api/paper/capabilities",route=>route.fulfill({json:{enabled:true}}));
  await page.route("**/api/memory/coverage",route=>route.fulfill({status,json:status===200?{
    source:{status:state,retained:3,verified:state==="partial"?1:3,complete:state==="verified",headSequence:3,
      categories:[{eventType:"<img src=x onerror=alert(1)>",category:"decisions",retained:3}],
      provenance:[{source:"manual",strategyId:"launch-v1",strategyVersion:"1",records:3}]},
    memory:{status:"not_implemented"},snapshotAt:"2026-10-04T18:00:00.000Z",limitations:["Browser-local history is excluded."]
  }:{error:"unavailable"}}));
  await page.goto("/memory");await expect(page.getByRole("link",{name:"Sign in with GitHub"})).toBeVisible();
  status=200;await page.getByRole("button",{name:"Refresh evidence"}).click();
  await expect(page.locator("#status")).toContainText("Retained stream verified");
  await expect(page.locator("#categories")).toContainText("<img src=x onerror=alert(1)>");await expect(page.locator("#categories img")).toHaveCount(0);
  await expect(page.locator("#export")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  state="partial";await page.locator("#refresh").click();await expect(page.locator("#status")).toContainText("Partial evidence");
  state="invalid";await page.locator("#refresh").click();await expect(page.locator("#status")).toContainText("integrity check failed");
  status=401;await page.locator("#refresh").click();await expect(page.locator("#report")).toBeHidden();await expect(page.locator("#coverage")).toBeEmpty();await expect(page.locator("#export")).toBeHidden();
  expect(await page.evaluate(()=>Object.keys(localStorage).length)).toBe(0);
});
