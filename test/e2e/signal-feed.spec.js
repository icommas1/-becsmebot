const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { createSignalApp } = require('../../src/signals/app');
const { fixtureMarket } = require('../fixtures/market');
let server, origin;
test.beforeAll(async () => {
  server = createSignalApp(await fixtureMarket()).listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
test('source selection displays actual membership and retires old routes without touching saved data', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('becs-saved-history-check', 'retain'));
  await page.goto(origin);
  await expect(page.locator('.row').first()).toBeVisible();
  await page.locator('#source').selectOption('dex:top');
  await expect(page.getByText(/Top paid boosts · Reporting/)).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open BecsSuperAgent' })).toHaveAttribute('href', 'https://becssuperagent-lcforo.v2.appdeploy.ai/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem('becs-saved-history-check'))).toBe('retain');
  expect((await request.get(origin + '/paper')).status()).toBe(410);
});
