import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:18080/api/v1';
const profile = { age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no', conflictStyle: 'talk_now', repairNeed: 'being_heard', fightTopics: ['chores'], goal: 'understand_each_other' };
type Current = { type: string; stage: string; optionLeft: string; agentQuestion: string };

async function create(page: Page) {
  expect((await page.request.post(`${API}/couples`, { data: profile })).ok()).toBeTruthy();
  await page.goto('/choose');
  await page.getByRole('button', { name: /Talk to Love Lab now/ }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  return page.url().split('/').pop()!;
}
async function answer(page: Page, id: string, privateText = 'I felt unheard when the dishes were left for me.') {
  const data = await (await page.request.get(`${API}/fight-sessions/${id}`)).json();
  const current = data.currentTurn as Current;
  if (current.type !== 'next_turn') return current.type;
  await expect(page.getByRole('heading', { name: current.agentQuestion, exact: true })).toBeVisible();
  if (current.stage.startsWith('thermometer')) {
    await page.getByRole('radio', { name: current.stage === 'thermometer_start' ? '8' : '5', exact: true }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else if (current.stage === 'facts') {
    await page.getByLabel('Or put it in your own words').fill(privateText);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else {
    await page.getByRole('button', { name: current.optionLeft, exact: true }).click();
  }
  await expect.poll(async () => {
    const updated = await (await page.request.get(`${API}/fight-sessions/${id}`)).json();
    return updated.currentTurn?.agentQuestion !== current.agentQuestion || updated.currentTurn?.type !== current.type;
  }).toBeTruthy();
  return current.stage;
}

test('two private preparations, checkout, shared journal, ratings and deletion', async ({ page, browser }) => {
  const sentinel = 'PRIVATE_A_DISHES: I need us to share the dishes fairly.';
  const idA = await create(page);
  for (let i = 0; i < 4; i++) await answer(page, idA, sentinel);
  await expect(page).toHaveURL(/\/paywall\?/);
  await expect(page.getByText('Your opening words are next.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${idA}$`));
  for (let i = 0; i < 3; i++) await answer(page, idA);
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
  await expect(b).toHaveURL(/\/choose$/);
  await b.getByRole('button', { name: /Talk to Love Lab now/ }).click();
  await expect(b).toHaveURL(/\/fight-sessions\/[^/]+$/);
  const idB = b.url().split('/').pop()!;
  for (let i = 0; i < 7; i++) await answer(b, idB, 'I did not realize how much help was needed with the dishes.');
  await expect(b).toHaveURL(new RegExp(`/fight-sessions/${idB}/result$`));
  await expect(b.locator('body')).not.toContainText(sentinel);
  expect((await b.request.get(`${API}/fight-sessions/${idA}`)).status()).toBe(404);
  await b.getByRole('button', { name: 'Rate your conversation' }).click();
  await b.getByRole('radio', { name: '9', exact: true }).check();
  await b.getByRole('button', { name: 'Save rating' }).click();
  await expect(b).toHaveURL(/\/journal$/);
  await page.goto(`/fight-sessions/${idA}/result`);
  await page.getByRole('button', { name: 'Rate your conversation' }).click();
  await page.getByRole('radio', { name: '8', exact: true }).check();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.locator('.journal-rating strong')).toHaveText('8.5');
  await page.goto('/stats');
  await expect(page.locator('.stat-line strong')).toHaveText('1');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete everything' }).click();
  await expect(page.getByRole('heading', { name: /Better conversations/ })).toBeVisible();
  await b.reload();
  await expect(b.getByRole('heading', { name: /Better conversations/ })).toBeVisible();
  await contextB.close();
});

test('generation failure keeps draft; reload, back and skip reconcile server state', async ({ page }) => {
  const id = await create(page);
  await answer(page, id);
  await page.getByLabel('Or put it in your own words').fill('A synthetic thought worth keeping.');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByLabel('Or put it in your own words')).toHaveValue('A synthetic thought worth keeping.');
  await page.route(`**/fight-sessions/${id}/turns`, async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'generation_unavailable', message: 'The next step could not be prepared.' }) });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText("We couldn't prepare the next step. Please try again.")).toBeVisible();
  await expect(page.getByLabel('Or put it in your own words')).toHaveValue('A synthetic thought worth keeping.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.page-number')).toHaveText('02');
  await page.reload();
  await expect(page.locator('.page-number')).toHaveText('02');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.locator('.page-number')).toHaveText('01');
  await page.getByRole('button', { name: 'Skip this topic', exact: true }).click();
  await page.getByRole('button', { name: 'Skip this topic', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'We can leave this here.' })).toBeVisible();
  expect((await (await page.request.get(`${API}/fight-sessions/${id}`)).json()).turns).toEqual([]);
});

test('safety clears the private conversation without a partner notification', async ({ page }) => {
  const id = await create(page);
  await answer(page, id);
  await page.getByLabel('Or put it in your own words').fill('I want to kill myself');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your safety comes first.' })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  const saved = await (await page.request.get(`${API}/fight-sessions/${id}`)).json();
  expect(saved.status).toBe('stopped_safety');
  expect(saved.turns).toEqual([]);
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
