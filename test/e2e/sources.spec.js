const {test,expect}=require('@playwright/test');
test('source center lists selected tools, separates reporting feeds and fits the viewport',async({page})=>{
  await page.goto('/assets/sources.html');
  await expect(page.getByRole('heading',{name:'Sources, not guesswork.'})).toBeVisible();
  await expect(page.locator('[data-tool]')).toHaveCount(8);
  await expect(page.locator('[data-feed]')).toHaveCount(19);
  await expect(page.locator('#execution')).toHaveText('Live trading disabled');
  await expect(page.locator('#archive')).toHaveText('Archive capture paused');
  await page.getByLabel('Find a tool or role').fill('research');
  await expect(page.locator('[data-tool="exa"]')).toBeVisible();
  await expect(page.locator('[data-tool="github"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('backend failures retain cached feed counts but do not claim freshness',async({page})=>{
  await page.goto('/assets/sources.html');
  await expect(page.locator('#execution')).toHaveText('Live trading disabled');
  await page.route('**/health',route=>route.abort());
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.locator('#connection')).toContainText('Backend status unavailable');
  await expect(page.locator('[data-feed="recent"]')).toContainText('Disconnected');
  await expect(page.locator('#execution')).toHaveText('Execution status unavailable');
  await page.unroute('**/health');
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.locator('#execution')).toHaveText('Live trading disabled');
});
test('terminal exposes source center without changing trade controls',async({page})=>{
  await page.goto('/terminal');
  const link=page.getByRole('link',{name:'Sources & tools'});
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading',{name:'Sources, not guesswork.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Sources & engines',exact:true})).toHaveAttribute('href','/research');
  await expect(page.getByRole('link',{name:'Memory evidence',exact:true})).toHaveAttribute('href','/memory');
  await page.getByRole('link',{name:'BecsSuperAgent',exact:true}).click();
  await expect(page.locator('#status')).toContainText('disabled');
});
