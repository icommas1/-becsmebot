const {test,expect}=require('@playwright/test');
const {CATALOG}=require('../../src/research/service');
async function ready(page){
  await page.route('**/api/research/status',route=>route.fulfill({json:{catalog:CATALOG.map(x=>({...x,status:x.kind==='reader'?'untested':'support-only'})),accountEnabled:true}}));
  await page.route('**/api/auth/status',route=>route.fulfill({json:{authenticated:true}}));
  await page.goto('/research');await expect(page.locator('#connection-status')).toContainText('Owner signed in');
}
test('research recipes save independently and survive reload without automatic requests',async({page})=>{
  let calls=0;await page.route('**/api/research/query',route=>{calls++;return route.abort();});
  await ready(page);await page.locator('#engine-name').fill('My early research');await page.locator('#engine-query').fill('Public Solana launch announcements');
  await page.locator('#save-engine').click();await expect(page.locator('#saved-engines')).toContainText('My early research');
  await page.reload();await expect(page.locator('#saved-engines')).toContainText('My early research');
  await page.getByRole('button',{name:'Load',exact:true}).click();await expect(page.locator('#engine-query')).toHaveValue('Public Solana launch announcements');
  expect(calls).toBe(0);expect(await page.evaluate(()=>localStorage.getItem('becsPaperV1'))).toBe(null);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
test('both readers produce one source card for one original document, with safe text',async({page})=>{
  let request;await page.route('**/api/research/query',route=>{
    request=route.request().postDataJSON();return route.fulfill({json:{query:request.query,documentCount:1,retrievedAt:'2026-10-02T18:00:00.000Z',cached:false,providers:[{id:'exa',status:'ready',documentCount:1},{id:'parallel',status:'ready',documentCount:1}],documents:[{url:'https://example.com/research',host:'example.com',title:'Source evidence',excerpt:'<img src=x onerror=alert(1)>',readers:['exa','parallel']}]}});
  });
  await ready(page);await page.locator('#engine-name').fill('Two readers');await page.locator('#engine-query').fill('Public Solana launches');await page.locator('#run-engine').click();
  await expect(page.locator('#research-results .document')).toHaveCount(1);await expect(page.locator('#research-results')).toContainText('It counts once.');
  await expect(page.locator('#research-results img')).toHaveCount(0);expect(request.providers).toEqual(['exa','parallel']);await expect(page.locator('#run-engine')).toBeEnabled();
});
test('research failures are visible and preserve the recipe',async({page})=>{
  await page.route('**/api/research/query',route=>route.fulfill({status:429,json:{error:'Free reader quota reached.'}}));
  await ready(page);await page.locator('#engine-name').fill('My research');await page.locator('#engine-query').fill('Public Solana launches');await page.locator('#run-engine').click();
  await expect(page.locator('#run-status')).toContainText('Free reader quota reached.');await expect(page.locator('#engine-query')).toHaveValue('Public Solana launches');await expect(page.locator('#run-engine')).toBeEnabled();
});
