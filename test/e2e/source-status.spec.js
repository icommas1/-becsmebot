const {test,expect}=require('@playwright/test');

test('source center distinguishes archive degradation, disconnection and recovery',async({page})=>{
  let state='degraded';
  await page.route('**/health/archive',async route=>{
    if(state==='offline')return route.abort();
    return route.fulfill({
      status:state==='degraded'?503:200,
      contentType:'application/json',
      body:JSON.stringify({enabled:true,healthy:state==='healthy'})
    });
  });
  await page.goto('/assets/sources.html');
  await expect(page.locator('#archive')).toHaveText('Archive capture needs attention');
  await expect(page.locator('#execution')).toHaveText('Live trading disabled');
  state='offline';
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.locator('#archive')).toHaveText('Archive status unavailable');
  state='healthy';
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.locator('#archive')).toHaveText('Archive capture enabled');
  await expect(page.locator('#execution')).toHaveText('Live trading disabled');
});

test('source center rejects malformed and contradictory archive failure reports',async({page})=>{
  await page.goto('/assets/sources.html');
  await expect(page.locator('#archive')).toHaveText('Archive capture paused');
  for(const report of [{error:'Unavailable'},{enabled:false,healthy:true},{enabled:true,healthy:true}]){
    await page.route('**/health/archive',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify(report)}));
    await page.getByRole('button',{name:'Refresh status'}).click();
    await expect(page.locator('#archive')).toHaveText('Archive status unavailable');
    await page.unroute('**/health/archive');
    await page.getByRole('button',{name:'Refresh status'}).click();
    await expect(page.locator('#archive')).toHaveText('Archive capture paused');
  }
});

test('archive-specific handling never treats failed market or wallet requests as connected',async({page})=>{
  await page.goto('/assets/sources.html');
  await expect(page.locator('#execution')).toHaveText('Live trading disabled');
  await expect(page.locator('#wallet')).toContainText('Wallet intelligence');
  await page.route('**/health',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:true,tradingEnabled:false,feeds:{}})}));
  await page.route('**/api/wallet-intel',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({enabled:false,providers:{}})}));
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.locator('#execution')).toHaveText('Execution status unavailable');
  await expect(page.locator('#wallet')).toHaveText('Wallet-intelligence status unavailable');
  await expect(page.locator('#connection')).toContainText('Backend status unavailable');
});
