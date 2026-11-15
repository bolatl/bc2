import { expect, test, type Page } from '@playwright/test';
import type { Couple, Fight, Personality } from '../src/api/types';
import { answerCurrent, finishPreparation, openPlanFromInsight } from './flow-helpers';
import { completeDemoCheckout } from './checkout-helpers';

const API = 'http://localhost:18080/api/v1';
const profile = { partnerName: 'Sam', relationshipStatus: 'married', age: '30-34', conflictStyle: 'get_loud', repairNeed: 'alone_time' };

async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(`${API}${path}`, { data });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function capture(page: Page, name: string) {
  for (const [label, width] of [['desktop', 1440], ['mobile', 375]] as const) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `/tmp/kintsugi-navigation-review/${name}-${label}.png`, fullPage: true, animations: 'disabled' });
  }
}

test('journal keeps previous and current conversations and reuses paid access with a fresh invite', async ({ page, browser }) => {
  await post(page, '/couples', profile);
  await page.goto('/journal');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  const firstId = page.url().split('/').pop()!;
  for (let i = 0; i < 5; i++) await answerCurrent(page, API, firstId);
  await openPlanFromInsight(page, firstId);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await completeDemoCheckout(page);
  await finishPreparation(page, API, firstId);
  const first = await get<Couple>(page, '/couples/me');
  expect(first.subscription?.status).toBe('active');
  expect(first.inviteUrl).toBeTruthy();
  const oldToken = new URL(first.inviteUrl).pathname.split('/').pop();

  const checkoutRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/subscriptions/checkout') || request.url().includes('/subscriptions/confirm')) checkoutRequests.push(request.url()); });
  await page.goto('/journal');
  const firstCard = page.locator(`[data-session-id="${firstId}"]`);
  await expect(firstCard).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy invite link', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  const secondId = page.url().split('/').pop()!;
  expect(secondId).not.toBe(firstId);
  expect((await get<Fight>(page, `/fight-sessions/${secondId}`)).tier).toBe('full');
  expect((await page.request.get(`${API}/invites/${oldToken}`)).status()).toBe(404);

  await page.goto('/journal');
  await expect(page.getByRole('heading', { name: 'Current conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Previous conversations', exact: true })).toBeVisible();
  const secondCard = page.locator(`[data-session-id="${secondId}"]`);
  await expect(secondCard.getByRole('link', { name: 'Continue conversation', exact: true })).toBeVisible();
  await firstCard.getByRole('link', { name: 'View your summary', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${firstId}/result$`));
  await expect(page.locator('.summary-line')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved in your journal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy invite link', exact: true })).toHaveCount(0);
  await page.goto('/journal');
  await capture(page, 'journal-current-history');
  await secondCard.getByRole('link', { name: 'Continue conversation', exact: true }).click();
  await finishPreparation(page, API, secondId);
  const second = await get<Couple>(page, '/couples/me');
  expect(second.inviteUrl).not.toBe(first.inviteUrl);
  expect((await page.request.get(`${API}${new URL(second.inviteUrl).pathname}`)).status()).toBe(200);
  expect(second.subscription).toEqual(first.subscription);
  expect(checkoutRequests).toEqual([]);
  await page.goto('/partner');
  await expect(page.getByRole('heading', { name: 'Not ready yet', exact: true })).toBeVisible();

  const contextB = await browser.newContext();
  try {
    const b = await contextB.newPage();
    const newToken = new URL(second.inviteUrl).pathname.split('/').pop();
    await post(b, `/invites/${newToken}/join`, { age: '35-39', conflictStyle: 'shut_down', repairNeed: 'closeness' });
    const bFight = await post<Fight>(b, '/fight-sessions', {});
    await b.goto('/profile');
    await expect(b.locator('.profile-saved-details')).toContainText('I tend to go quiet');
    await expect(b.locator('.profile-saved-details')).toContainText('Closeness and reassurance');
    await expect(b.locator('.profile-saved-details')).not.toContainText('I tend to raise my voice');
    await b.goto('/partner');
    await expect(b.getByRole('heading', { name: 'Ready to talk', exact: true })).toBeVisible();
    await page.goto('/partner');
    await expect(page.getByRole('heading', { name: 'Preparing privately', exact: true })).toBeVisible();
    await capture(page, 'partner-preparing');
    await page.goto('/journal');
    await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeDisabled();
    const bList = await get<{ conversations: { sessionId: string }[] }>(b, '/fight-sessions');
    expect(bList.conversations.map(item => item.sessionId)).toEqual([bFight.sessionId]);
    expect((await b.request.get(`${API}/fight-sessions/${firstId}/result`)).status()).toBe(404);
    await b.goto(`/fight-sessions/${bFight.sessionId}`);
    await finishPreparation(b, API, bFight.sessionId);
    await page.goto('/partner');
    await expect(page.getByRole('heading', { name: 'Ready to talk', exact: true })).toBeVisible();
    await page.goto('/journal');
    await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeEnabled();
    expect(checkoutRequests).toEqual([]);
  } finally { await contextB.close(); }
});

test('My space gates patterns behind About me and Profile shows the caller’s own information', async ({ page }) => {
  await post(page, '/couples', profile);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'My space', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('link')).toHaveText(['My space', 'Journal', 'Partner']);
  await expect(page.getByRole('link', { name: 'Take the About me test', exact: true })).toHaveAttribute('href', '/personality');
  await expect(page.getByRole('heading', { name: 'What you bring', exact: true })).toHaveCount(0);
  expect(requests.some(url => url.endsWith('/journal/stats') || url.endsWith('/personality-tests/me'))).toBe(false);
  await capture(page, 'space-about-me');
  await page.getByRole('link', { name: 'Take the About me test', exact: true }).click();
  await expect(page).toHaveURL(/\/personality$/);
  await expect(page.getByRole('heading', { name: 'Am the life of the party.', exact: true })).toBeVisible();

  const report = await post<Personality>(page, '/personality-tests', { answers: Array.from({ length: 20 }, (_, index) => index % 5 + 1) });
  await page.goto('/stats');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'What you bring', exact: true })).toBeVisible();
  for (const text of report.strengths) await expect(page.getByText(text, { exact: true })).toBeVisible();
  for (const text of report.tips) await expect(page.getByText(text, { exact: true })).toBeVisible();
  await capture(page, 'space-patterns');
  await page.locator('.site-header').getByRole('link', { name: 'My profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('I tend to raise my voice');
  await expect(page.locator('main')).toContainText('Some time to myself');
  await expect(page.locator('main')).not.toContainText('I tend to go quiet');
  const couple = await get<Couple>(page, '/couples/me');
  expect(couple.ownProfile).toMatchObject(profile);
  await capture(page, 'profile');
});
