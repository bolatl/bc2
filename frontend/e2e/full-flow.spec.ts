import { expect, test, type Page } from '@playwright/test';
import { completeDemoCheckout } from './checkout-helpers';
import { answerCurrent, fightState, finishPreparation, openPlanFromInsight } from './flow-helpers';

const API = 'http://localhost:18080/api/v1';
const profile = { age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no', conflictStyle: 'talk_now', repairNeed: 'being_heard', fightTopics: ['chores'], goal: 'understand_each_other' };

async function create(page: Page) {
  expect((await page.request.post(`${API}/couples`, { data: profile })).ok()).toBeTruthy();
  await page.goto('/choose');
  await page.getByRole('button', { name: /Talk to Kintsugi now/ }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  return page.url().split('/').pop()!;
}
async function answer(page: Page, id: string, privateText?: string) {
  const fight = await fightState(page, API, id);
  return answerCurrent(page, API, id, privateText, fight.stage === 'thermometer_start' ? 8 : 5);
}

test('two private preparations, checkout, shared journal, ratings and deletion', async ({ page, browser }) => {
  const sentinel = 'PRIVATE_A_DISHES: I need us to share the dishes fairly.';
  const idA = await create(page);
  for (let i = 0; i < 5; i++) await answer(page, idA, sentinel);
  await openPlanFromInsight(page, idA);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await completeDemoCheckout(page);
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${idA}$`));
  await finishPreparation(page, API, idA);
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${idA}/result$`));
  await expect(page.locator('.summary-line')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
  const a = await (await page.request.get(`${API}/couples/me`)).json();
  expect(a.partnerRole).toBe('A');
  expect(a.currentSessionId).toBe(idA);

  const contextB = await browser.newContext();
  const b = await contextB.newPage();
  await b.goto(a.inviteUrl);
  await b.getByRole('radio').first().check();
  await b.getByRole('button', { name: 'Continue', exact: true }).click();
  await b.getByRole('radio').first().check();
  await b.getByRole('button', { name: 'Continue', exact: true }).click();
  await b.getByRole('radio').first().check();
  await b.getByRole('button', { name: 'Save and continue' }).click();
  await expect(b).toHaveURL(/\/fight-sessions\/[^/]+$/);
  const idB = b.url().split('/').pop()!;
  await finishPreparation(b, API, idB, 'I did not realize how much help was needed with the dishes.');
  await expect(b).toHaveURL(new RegExp(`/fight-sessions/${idB}/result$`));
  await expect(b.locator('body')).not.toContainText(sentinel);
  expect((await b.request.get(`${API}/fight-sessions/${idA}`)).status()).toBe(404);
  await b.getByRole('button', { name: 'Rate your conversation' }).click();
  await b.getByRole('slider', { name: 'Conversation rating, 1 to 10' }).fill('9');
  await b.getByRole('button', { name: 'Save rating' }).click();
  await expect(b).toHaveURL(/\/journal$/);
  await page.goto(`/fight-sessions/${idA}/result`);
  await page.getByRole('button', { name: 'Rate your conversation' }).click();
  await page.getByRole('slider', { name: 'Conversation rating, 1 to 10' }).fill('8');
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.locator('.record-status strong')).toContainText('8.5 / 10 together');
  expect((await page.request.post(`${API}/personality-tests`, { data: { answers: Array(20).fill(3) } })).ok()).toBeTruthy();
  await page.goto('/stats');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'Your conversations over time', exact: true })).toBeVisible();
  await expect(page.locator('.space-history-summary > strong')).toHaveText('1');
  const stats = await (await page.request.get(`${API}/journal/stats`)).json();
  expect(stats.totalFights).toBe(1);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete everything' }).click();
  await expect(page.getByRole('heading', { name: 'Rehearse the first sentence before you say it.', exact: true })).toBeVisible();
  await b.reload();
  await expect(b.getByRole('heading', { name: 'Rehearse the first sentence before you say it.', exact: true })).toBeVisible();
  await contextB.close();
});

test('generation failure keeps draft; reload, back and skip reconcile server state', async ({ page }) => {
  const id = await create(page);
  await answer(page, id);
  await page.getByLabel('Your story', { exact: true }).fill('A synthetic thought worth keeping.');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByLabel('Your story', { exact: true })).toHaveValue('A synthetic thought worth keeping.');
  await page.route(`**/fight-sessions/${id}/turns`, async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'generation_unavailable', message: 'The next step could not be prepared.' }) });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText("We couldn't prepare the next step. Please try again.")).toBeVisible();
  await expect(page.getByLabel('Your story', { exact: true })).toHaveValue('A synthetic thought worth keeping.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.page-number')).toHaveText('01');
  await page.reload();
  await expect(page.locator('.page-number')).toHaveText('01');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByLabel('Your story', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'End conversation', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'We can leave this here.' })).toBeVisible();
  expect((await (await page.request.get(`${API}/fight-sessions/${id}`)).json()).turns).toEqual([]);
});

test('safety clears the private conversation without a partner notification', async ({ page }) => {
  const id = await create(page);
  await answer(page, id);
  await page.getByLabel('Your story', { exact: true }).fill('I want to kill myself');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your safety comes first.' })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  const saved = await (await page.request.get(`${API}/fight-sessions/${id}`)).json();
  expect(saved.status).toBe('stopped_safety');
  expect(saved.turns).toEqual([]);
});

test('dictated interim words replace a previously selected card when submitting Next', async ({ page }) => {
  await page.addInitScript(() => {
    class SpeechStub {
      onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string }; length: number }[] }) => void) | null = null;
      listener = (event: Event) => this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: (event as CustomEvent<string>).detail }, length: 1 }] });
      start() { window.addEventListener('test:speech', this.listener); }
      abort() { window.removeEventListener('test:speech', this.listener); }
      stop() { this.abort(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: SpeechStub, configurable: true });
  });
  const id = await create(page);
  await answer(page, id);
  await answer(page, id, 'We disagreed about the dishes after dinner.');
  const { currentTurn: current } = await fightState(page, API, id);
  if (current?.type !== 'next_turn') throw new Error('Expected a context question');
  const card = page.getByRole('button', { name: current.optionLeft, exact: true });
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start voice input', exact: true }).click();
  const spoken = 'I felt unheard and needed a little patience.';
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('test:speech', { detail: text })), spoken);
  await expect(page.getByLabel('Or in your own words', { exact: true })).toHaveValue(spoken);
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  const request = page.waitForRequest(req => req.url() === `${API}/fight-sessions/${id}/turns` && req.method() === 'POST');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ answerSource: 'free_text', answerText: spoken });
  await expect.poll(async () => (await fightState(page, API, id)).turns.at(-1)?.answerText).toBe(spoken);
});

test('welcome and active form fit mobile and desktop', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/welcome-desktop.png', fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.screenshot({ path: 'test-results/welcome-mobile.png', fullPage: true });
  await create(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/conversation-mobile.png', fullPage: true });
});
