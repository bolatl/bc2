import { expect, test, type Page } from '@playwright/test';
import type { Fight, Result } from '../src/api/types';

const API = 'http://localhost:18080/api/v1';
const profile = { age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no', conflictStyle: 'talk_now', repairNeed: 'being_heard', fightTopics: ['chores'], goal: 'understand_each_other' };

async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function create(page: Page) {
  expect((await page.request.post(`${API}/couples`, { data: profile })).status()).toBe(201);
  await page.goto('/choose');
  await page.getByRole('button', { name: /Talk to Love Lab now/ }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  return page.url().split('/').pop()!;
}

async function answer(page: Page, id: string, text?: string) {
  const { currentTurn: turn } = await get<Fight>(page, `/fight-sessions/${id}`);
  if (turn?.type !== 'next_turn') throw new Error(`Expected a question, got ${turn?.type}`);
  await expect(page.getByRole('heading', { name: turn.agentQuestion, exact: true })).toBeVisible();
  if (turn.stage.startsWith('thermometer')) {
    await page.getByRole('radio', { name: '6', exact: true }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else if (text !== undefined) {
    await page.getByLabel('Or put it in your own words').fill(text);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else {
    await page.getByRole('button', { name: turn.optionLeft, exact: true }).click();
  }
  await expect.poll(async () => {
    const next = (await get<Fight>(page, `/fight-sessions/${id}`)).currentTurn;
    return next?.type !== 'next_turn' || next.turnIndex !== turn.turnIndex;
  }).toBeTruthy();
}

async function capture(page: Page, name: string) {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  for (const [size, width] of [['desktop', 1440], ['mobile', 375]] as const) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `/tmp/lovelab-reflection-review/${name}-${size}.png`, fullPage: true, animations: 'disabled' });
  }
}

test('typed context shapes questions; free explanations unlock practical steps after checkout', async ({ page, browser }) => {
  const id = await create(page);
  await answer(page, id);
  await answer(page, id, 'I washed all the dishes alone after dinner and raised the issue with my partner.');
  const feelings = (await get<Fight>(page, `/fight-sessions/${id}`)).currentTurn;
  expect(feelings?.type).toBe('next_turn');
  if (feelings?.type !== 'next_turn') throw new Error('Expected feelings question');
  expect(feelings.agentQuestion).toMatch(/dishes/i);
  await answer(page, id, 'I felt unheard when I tried to explain what had happened.');
  const needs = (await get<Fight>(page, `/fight-sessions/${id}`)).currentTurn;
  if (needs?.type !== 'next_turn') throw new Error('Expected needs question');
  expect(needs.agentQuestion).toMatch(/heard/i);
  await answer(page, id, 'I needed a clear plan for sharing the chores and time to finish what I was saying.');
  await expect(page).toHaveURL(url => url.pathname === '/paywall' && url.searchParams.get('sessionId') === id);

  const preview = await get<Result>(page, `/fight-sessions/${id}/result`);
  const reflection = preview.reflection;
  expect(reflection).toBeTruthy();
  if (!reflection) throw new Error('Expected reflection');
  expect(reflection.facets.length).toBeGreaterThanOrEqual(3);
  expect(reflection.facets.length).toBeLessThanOrEqual(5);
  const report = page.locator('.conversation-reflection');
  await expect(report.locator('.reflection-chart path')).toHaveCount(reflection.facets.length);
  await expect(report.locator('.reflection-chart')).toHaveCSS('filter', 'none');
  for (const facet of reflection.facets) {
    expect(facet.explanation.length).toBeGreaterThan(0);
    expect(facet.practice).toBeNull();
    await report.getByRole('button', { name: new RegExp(facet.label) }).click();
    await expect(report.locator('.reflection-detail')).toContainText(facet.explanation);
  }
  await expect(report.locator('.reflection-practice')).toHaveCount(0);
  await expect(report.locator('.reflection-detail-skeleton')).toHaveAttribute('inert', '');
  await expect(report.locator('.reflection-detail-skeleton')).toHaveAttribute('aria-hidden', 'true');
  await expect(report.locator('.reflection-detail-skeleton')).toHaveCSS('filter', 'blur(5px)');
  await expect(page.locator('.paywall-workspace > *')).toHaveCount(2);
  await expect(page.locator('.paywall-workspace > .plan-picker')).toHaveCount(1);
  await expect(page.locator('.paywall-reflection-column > *')).toHaveCount(1);
  await capture(page, 'paywall');

  const outsider = await browser.newContext();
  try {
    const other = await outsider.newPage();
    const otherId = await create(other);
    expect((await other.request.get(`${API}/fight-sessions/${id}/result`)).status()).toBe(404);
    await answer(other, otherId);
    await answer(other, otherId, 'We disagreed about the budget for next month and paying the bills.');
    const money = (await get<Fight>(other, `/fight-sessions/${otherId}`)).currentTurn;
    if (money?.type !== 'next_turn') throw new Error('Expected money feelings question');
    expect(money.agentQuestion).toMatch(/budget|expenses|bills/i);
    expect(money.agentQuestion).not.toBe(feelings.agentQuestion);
  } finally { await outsider.close(); }

  await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${id}$`));
  for (let index = 0; index < 3; index++) await answer(page, id);
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${id}/result$`));
  const unlocked = await get<Result>(page, `/fight-sessions/${id}/result`);
  expect(unlocked.reflection).toBeTruthy();
  if (!unlocked.reflection) throw new Error('Expected unlocked reflection');
  const fullReport = page.locator('.conversation-reflection');
  await expect(fullReport.locator('.reflection-detail-skeleton')).toHaveCount(0);
  for (const facet of unlocked.reflection.facets) {
    expect(facet.practice).toBeTruthy();
    await fullReport.getByRole('button', { name: new RegExp(facet.label) }).click();
    await expect(fullReport.locator('.reflection-detail')).toContainText(facet.explanation);
    await expect(fullReport.locator('.reflection-practice')).toContainText(facet.practice!);
  }
  await capture(page, 'result');
});
