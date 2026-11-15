import { answerCurrent } from './flow-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Checkpoint, Couple, Fight, JournalEntry, Result } from '../src/api/types';

const API = 'http://localhost:18082/api/v1';
const profile = { age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no', conflictStyle: 'talk_now', repairNeed: 'being_heard', fightTopics: ['chores'], goal: 'understand_each_other' };

async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function start(page: Page) {
  await page.goto('/choose');
  await page.getByRole('button', { name: /Talk to Kintsugi now/ }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  return page.url().split('/').pop()!;
}

async function create(page: Page) {
  expect((await page.request.post(`${API}/couples`, { data: profile })).status()).toBe(201);
  return start(page);
}

async function answer(page: Page, id: string, expectedStage: string, text?: string) {
  expect((await get<Fight>(page, `/fight-sessions/${id}`)).stage).toBe(expectedStage);
  await answerCurrent(page, API, id, text, 8);
}

async function checkpoint(page: Page, id: string, feelings = 'I felt alone doing the dishes.') {
  await answer(page, id, 'thermometer_start');
  await answer(page, id, 'facts', 'We disagreed about who would wash the dishes.');
  await answer(page, id, 'feelings', feelings);
  const { currentTurn } = await get<Fight>(page, `/fight-sessions/${id}`);
  if (currentTurn?.type !== 'checkpoint') throw new Error('Expected a checkpoint after feelings');
  expect(currentTurn.afterStage).toBe('feelings');
  await expectCheckpoint(page, currentTurn);
  return currentTurn;
}

async function expectCheckpoint(page: Page, current: Checkpoint) {
  await expect(page.getByRole('heading', { name: current.question, exact: true })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Your private checkpoint summary' });
  for (const text of Object.values(current.summary)) await expect(summary).toContainText(text);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Wrap up', exact: true })).toBeEnabled();
}

async function decide(page: Page, id: string, decision: 'stop' | 'continue') {
  const response = page.waitForResponse(res => res.url() === `${API}/fight-sessions/${id}/checkpoint` && res.request().method() === 'POST');
  await page.getByRole('button', { name: decision === 'stop' ? 'Wrap up' : 'Continue', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toEqual({ decision });
  await expect.poll(async () => (await get<Fight>(page, `/fight-sessions/${id}`)).stage).toBe(decision === 'stop' ? 'ready' : 'needs');
}

async function finish(page: Page, id: string) {
  await answer(page, id, 'ready');
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${id}/result$`));
  await expect(page.locator('.summary-line')).toBeVisible();
  const result = await get<Result>(page, `/fight-sessions/${id}/result`);
  expect(result.thermometerStart).toBe(8);
  expect(result.thermometerEnd).toBeNull();
  await expect(page.locator('.thermometer-result')).toContainText('8');
  await expect(page.locator('.thermometer-result')).not.toContainText('After');
  return result;
}

test('short flow checkpoint survives reload and a failed decision can be retried', async ({ page }) => {
  const id = await create(page);
  await expect(page.getByText('Full demo access — no payment needed', { exact: false })).toBeVisible();
  const current = await checkpoint(page, id);
  await page.reload();
  await expectCheckpoint(page, current);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.screenshot({ path: 'test-results/backend-v2/checkpoint-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.screenshot({ path: 'test-results/backend-v2/checkpoint-mobile.png', fullPage: true });
  await page.route(`**/fight-sessions/${id}/checkpoint`, route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ code: 'generation_unavailable', message: 'The next step could not be prepared.' }),
  }), { times: 1 });
  const reconciled = page.waitForResponse(res => res.url() === `${API}/fight-sessions/${id}` && res.request().method() === 'GET');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await reconciled;
  await expectCheckpoint(page, current);
  await expect(page.getByRole('alert')).toContainText("We couldn't prepare the next step. Please try again.");
  await decide(page, id, 'continue');
  await answer(page, id, 'needs', 'I needed a clear plan for the chores.');
  await expect(page.getByText('Find a little perspective', { exact: true })).toHaveCount(0);
  await finish(page, id);
});

test('wrapping up a checkpoint skips remaining questions and keeps the initial intensity only', async ({ page }) => {
  const id = await create(page);
  await checkpoint(page, id);
  await decide(page, id, 'stop');
  const state = await get<Fight>(page, `/fight-sessions/${id}`);
  expect(state.turns.map(turn => turn.stage)).toEqual(['thermometer_start', 'facts', 'feelings']);
  await page.reload();
  await finish(page, id);
});

test('checkpoint back rewinds its answer and skipping clears the private preparation', async ({ page }) => {
  const id = await create(page);
  await checkpoint(page, id);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your private checkpoint summary' })).toHaveCount(0);
  const rewound = await get<Fight>(page, `/fight-sessions/${id}`);
  expect(rewound.currentTurn?.type).toBe('next_turn');
  expect(rewound.stage).toBe('feelings');
  expect(rewound.turns.map(turn => turn.stage)).toEqual(['thermometer_start', 'facts']);
  await answer(page, id, 'feelings', 'I felt worried about getting the chores wrong.');
  const { currentTurn } = await get<Fight>(page, `/fight-sessions/${id}`);
  if (currentTurn?.type !== 'checkpoint') throw new Error('Expected a new checkpoint after revising feelings');
  await expectCheckpoint(page, currentTurn);
  await expect(page.getByRole('region', { name: 'Your private checkpoint summary' })).toContainText('I felt worried');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'End conversation', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'We can leave this here.', exact: true })).toBeVisible();
  const skipped = await get<Fight>(page, `/fight-sessions/${id}`);
  expect(skipped.status).toBe('skipped');
  expect(skipped.turns).toEqual([]);
  expect(skipped.currentTurn).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'We can leave this here.', exact: true })).toBeVisible();
});

test('free answers count Unicode code points and accept exactly 300', async ({ page }) => {
  const id = await create(page);
  await answer(page, id, 'thermometer_start');
  const input = page.getByLabel('Your story', { exact: true });
  await input.fill('🙂'.repeat(301));
  await expect(page.locator('#answer-count')).toContainText('301 / 300');
  await expect(page.getByRole('alert')).toContainText('Please keep your answer within 300 characters.');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  expect((await get<Fight>(page, `/fight-sessions/${id}`)).stage).toBe('facts');
  const accepted = '🙂'.repeat(300);
  await input.fill(accepted);
  await expect(page.locator('#answer-count')).toContainText('300 / 300');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await answer(page, id, 'facts', accepted);
  expect((await get<Fight>(page, `/fight-sessions/${id}`)).turns.at(-1)?.answerText).toBe(accepted);
});

test('journal details show each partner their own summary and reject another couple', async ({ page, browser }) => {
  const idA = await create(page);
  await checkpoint(page, idA, 'I felt alone doing the dishes.');
  await decide(page, idA, 'continue');
  await answer(page, idA, 'needs', 'I needed a clear plan for the chores.');
  const resultA = await finish(page, idA);
  const couple = await get<Couple>(page, '/couples/me');
  expect(couple.inviteUrl).toBeTruthy();

  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  try {
    const b = await contextB.newPage();
    await b.goto(couple.inviteUrl!);
    for (let step = 0; step < 3; step++) {
      await b.getByRole('radio').first().check();
      await b.getByRole('button', { name: step === 2 ? 'Save and continue' : 'Continue', exact: true }).click();
    }
    await expect(b).toHaveURL(/\/fight-sessions\/[^/]+$/);
    const idB = b.url().split('/').pop()!;
    await checkpoint(b, idB, 'I felt worried that we would argue again.');
    await decide(b, idB, 'continue');
    await answer(b, idB, 'needs', 'I needed warmth and closeness.');
    const resultB = await finish(b, idB);
    const recordId = resultB.fightRecordId;
    expect(recordId).toBeTruthy();
    expect(resultA.feltText).not.toBe(resultB.feltText);
    expect(resultA.openingLine).not.toBe(resultB.openingLine);

    for (const [owner, own, other] of [[page, resultA, resultB], [b, resultB, resultA]] as const) {
      await owner.goto('/journal');
      await owner.locator(`a[href="/journal/${recordId}"]`).click();
      await expect(owner.getByRole('heading', { name: 'Your conversation, revisited.', exact: true })).toBeVisible();
      const entry = await get<JournalEntry>(owner, `/journal/${recordId}`);
      expect(entry.myResult?.sessionId).toBe(own.sessionId);
      const summary = owner.locator('.journal-entry-summary');
      for (const text of [own.feltText, own.needText, own.openingLine, ...own.sharedRules]) await expect(summary).toContainText(text);
      await expect(owner.locator('body')).not.toContainText(other.feltText);
      await expect(owner.locator('body')).not.toContainText(other.openingLine);
      await owner.reload();
      await expect(summary).toContainText(own.openingLine);
      if (owner === page) {
        await owner.setViewportSize({ width: 1440, height: 1000 });
        await owner.screenshot({ path: 'test-results/backend-v2/journal-entry-desktop.png', fullPage: true });
        await owner.setViewportSize({ width: 375, height: 844 });
        expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        await owner.screenshot({ path: 'test-results/backend-v2/journal-entry-mobile.png', fullPage: true });
      }
    }

    // Old records can retain shared metadata without a retrievable private result.
    const entry = await get<JournalEntry>(page, `/journal/${recordId}`);
    await page.route(`**/api/v1/journal/${recordId}`, route => route.fulfill({ json: { ...entry, myResult: null } }));
    await page.reload();
    await expect(page.getByText('Your personal summary is unavailable for this conversation. You can still view the shared details and add a check-in.', { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/journal/${recordId}/rating"]`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(resultA.openingLine);

    const outsider = await contextC.newPage();
    expect((await outsider.request.post(`${API}/couples`, { data: profile })).status()).toBe(201);
    expect((await outsider.request.get(`${API}/journal/${recordId}`)).status()).toBe(404);
    await outsider.goto(`/journal/${recordId}`);
    await expect(outsider.getByText('This conversation is unavailable.', { exact: true })).toBeVisible();
    await expect(outsider.locator('.journal-entry-summary')).toHaveCount(0);
    await expect(outsider.locator('body')).not.toContainText(resultA.openingLine);
    await expect(outsider.locator('body')).not.toContainText(resultB.openingLine);
  } finally {
    await contextB.close();
    await contextC.close();
  }
});
