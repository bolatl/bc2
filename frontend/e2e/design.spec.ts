import { answerCurrent } from './flow-helpers';
import { expect, test, type Page } from '@playwright/test';
import { completeDemoCheckout } from './checkout-helpers';
import type { Checkout, Couple, Fight } from '../src/api/types';

const API = 'http://localhost:18080/api/v1';
const profile = { age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no', conflictStyle: 'talk_now', repairNeed: 'being_heard', fightTopics: ['chores'], goal: 'understand_each_other' };
const screenshots = '/tmp/lovelab-sakura-review';

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
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  for (const [label, width] of [['desktop', 1440], ['mobile', 375]] as const) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `${screenshots}/${name}-${label}.png`, fullPage: true, animations: 'disabled' });
  }
}

async function start(page: Page) {
  await page.goto('/choose');
  await page.getByRole('button', { name: /Talk to Kintsugi now/ }).click();
  await expect(page).toHaveURL(/\/fight-sessions\/[^/]+$/);
  return page.url().split('/').pop()!;
}

async function answer(page: Page, id: string, text?: string) {
  await answerCurrent(page, API, id, text);
}

async function activatePlan(page: Page) {
  const checkout = await post<Checkout>(page, '/subscriptions/checkout', { plan: 'monthly' });
  await post(page, '/subscriptions/confirm', { checkoutSessionId: checkout.checkoutSessionId });
}

async function completePreparation(page: Page, sentinel: string) {
  const { sessionId } = await post<Fight>(page, '/fight-sessions', {});
  for (let index = 0; index < 12; index++) {
    const state = await get<Fight>(page, `/fight-sessions/${sessionId}`);
    if (state.status === 'completed') return sessionId;
    const current = state.currentTurn;
    if (current?.type !== 'next_turn') throw new Error(`Unexpected setup state ${current?.type}`);
    const freeText = current.stage.startsWith('thermometer') ? '6' : current.stage === 'facts' ? sentinel : undefined;
    await post(page, `/fight-sessions/${sessionId}/turns`, {
      turnIndex: current.turnIndex, answerSource: freeText === undefined ? 'card_left' : 'free_text',
      ...(freeText === undefined ? {} : { answerText: freeText }),
    });
  }
  throw new Error('Preparation did not finish');
}

type MotionRecord = { target: string; phase: string | null; direction: string | null; x: number[]; delay: number };

async function observeQuestionMotion(page: Page) {
  await page.evaluate(() => {
    const originalAnimate = Element.prototype.animate;
    const records: MotionRecord[] = [];
    document.documentElement.dataset.questionMotion = '[]';
    Element.prototype.animate = function (keyframes, options) {
      const animation = originalAnimate.call(this, keyframes, options);
      const panel = this.closest('.page-content[data-transition-key]');
      if (panel) {
        const effect = animation.effect as KeyframeEffect;
        records.push({
          target: this === panel ? 'panel' : this.matches('.answer-card') ? 'answer' : 'other',
          phase: panel.getAttribute('data-swipe-phase'),
          direction: panel.getAttribute('data-swipe-direction'),
          x: effect.getKeyframes().map(frame => Number(String(frame.transform).match(/translate(?:3d|X)?\(\s*(-?[\d.]+)/)?.[1] ?? 0)),
          delay: effect.getTiming().delay,
        });
        document.documentElement.dataset.questionMotion = JSON.stringify(records);
      }
      return animation;
    };
  });
}

async function questionMotion(page: Page): Promise<MotionRecord[]> {
  return page.evaluate(() => JSON.parse(document.documentElement.dataset.questionMotion || '[]'));
}

test('questions swipe with staggered answers, reverse on Back, and respect reduced motion', async ({ page }) => {
  await page.goto('/');
  await capture(page, 'landing');
  await post(page, '/couples', profile);
  const id = await start(page);
  const journey = page.locator('.sakura-journey');
  const camera = journey.locator('.journey-camera');
  const panel = page.locator('.page-content[data-transition-key]');
  await expect(journey).toHaveAttribute('data-stage', 'thermometer_start');
  expect(await camera.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
  await observeQuestionMotion(page);
  const initialPosition = await camera.getAttribute('style');
  await answer(page, id);
  await expect(journey).toHaveAttribute('data-stage', 'facts');
  await expect(panel).toHaveAttribute('data-swipe-phase', 'idle');
  const forward = (await questionMotion(page)).filter(record => record.target === 'panel');
  expect(forward.map(record => record.phase)).toEqual(['leaving', 'entering']);
  expect(forward.every(record => record.direction === 'forward')).toBeTruthy();
  expect(forward[0].x.at(-1)).toBeLessThan(0);
  expect(forward[1].x[0]).toBeGreaterThan(0);
  const factsPosition = await camera.getAttribute('style');
  expect(factsPosition).not.toBe(initialPosition);
  await answer(page, id, 'I would like us to share the evening chores.');
  await expect(journey).toHaveAttribute('data-stage', 'feelings');
  await expect(panel).toHaveAttribute('data-swipe-phase', 'idle');
  expect(await camera.getAttribute('style')).not.toBe(factsPosition);
  const cards = (await questionMotion(page)).filter(record => record.target === 'answer');
  expect(cards).toHaveLength(2);
  expect(cards.every(record => record.phase === 'entering' && record.x[0] > 0)).toBeTruthy();
  expect(cards[1].delay).toBeGreaterThan(cards[0].delay);
  const motionBeforeSelection = await questionMotion(page);
  const firstAnswer = page.locator('.answer-card').first();
  await firstAnswer.click();
  await expect(firstAnswer).toHaveAttribute('aria-pressed', 'true');
  expect(await questionMotion(page)).toEqual(motionBeforeSelection);
  await capture(page, 'journey');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(journey).toHaveAttribute('data-stage', 'facts');
  await expect(panel).toHaveAttribute('data-swipe-phase', 'idle');
  const backward = (await questionMotion(page)).filter(record => record.target === 'panel' && record.direction === 'backward');
  expect(backward.map(record => record.phase)).toEqual(['leaving', 'entering']);
  expect(backward[0].x.at(-1)).toBeGreaterThan(0);
  expect(backward[1].x[0]).toBeLessThan(0);
  expect(await camera.getAttribute('style')).toBe(factsPosition);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motionBeforeReduce = await questionMotion(page);
  await answer(page, id, 'I would like to agree on a fair plan for chores.');
  await expect(journey).toHaveAttribute('data-stage', 'feelings');
  expect(await questionMotion(page)).toEqual(motionBeforeReduce);
  await expect(camera).toHaveCSS('transition-duration', '0s');
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('questions stay in place while saving or after failure, and active motion can be reduced', async ({ page }) => {
  await post(page, '/couples', profile);
  const id = await start(page);
  await answer(page, id);
  const panel = page.locator('.page-content[data-transition-key]');
  await expect(panel).toHaveAttribute('data-swipe-phase', 'idle');
  await observeQuestionMotion(page);
  const story = page.getByLabel('Your story', { exact: true });
  const draft = 'I felt left alone with the dishes after dinner.';
  await story.fill(draft);
  let releaseRequest = () => {};
  let requestStarted = () => {};
  const heldRequest = new Promise<void>(resolve => { releaseRequest = resolve; });
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  await page.route(`**/fight-sessions/${id}/turns`, async route => {
    requestStarted();
    await heldRequest;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'generation_unavailable', message: 'The next step could not be prepared.' }) });
  }, { times: 1 });
  try {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await started;
    await expect(story).toHaveValue(draft);
    await expect(panel).toHaveAttribute('data-swipe-phase', 'idle');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    expect(await questionMotion(page)).toEqual([]);
  } finally {
    releaseRequest();
  }
  await expect(page.getByRole('alert')).toContainText("We couldn't prepare the next step. Please try again.");
  await expect(story).toHaveValue(draft);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect(await questionMotion(page)).toEqual([]);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(panel).toHaveAttribute('data-swipe-phase', 'entering');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(panel).toHaveAttribute('data-swipe-phase', 'idle');
  await expect(page.locator('.sakura-journey')).toHaveAttribute('data-stage', 'feelings');
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('personal and partner views use the current role and shared status without private answers', async ({ page, browser }) => {
  const privateA = 'PRIVATE_A_SAKURA: I felt unheard about the household chores.';
  const privateB = 'PRIVATE_B_SAKURA: I needed a little time to collect my thoughts.';
  await post(page, '/couples', profile);
  await activatePlan(page);
  await completePreparation(page, privateA);
  const couple = await get<Couple>(page, '/couples/me');
  expect(couple.partnerRole).toBe('A');
  const contextB = await browser.newContext();
  try {
    const b = await contextB.newPage();
    const token = new URL(couple.inviteUrl).pathname.split('/').pop();
    await post(b, `/invites/${token}/join`, { age: '35-39', conflictStyle: 'talk_now', repairNeed: 'being_heard' });
    const bFight = await post<Fight>(b, '/fight-sessions', {});
    await post(b, `/fight-sessions/${bFight.sessionId}/turns`, { turnIndex: 0, answerSource: 'free_text', answerText: '6' });
    await post(b, `/fight-sessions/${bFight.sessionId}/turns`, { turnIndex: 1, answerSource: 'free_text', answerText: privateB });

    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'My space', exact: true })).toBeVisible();
    await capture(page, 'home');
    await page.locator('.site-header').getByRole('link', { name: 'My profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    await expect(page.locator('.profile-role')).toHaveText('Partner A');
    await expect(page.locator('.profile-plan-status')).toHaveText('Full access is active');
    await expect(page.locator('main')).not.toContainText(privateB);
    await capture(page, 'profile');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Partner', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your partner’s progress', exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(privateA);
    await expect(page.locator('main')).not.toContainText(privateB);
    await expect(page.getByRole('heading', { name: 'Preparing privately', exact: true })).toBeVisible();
    await expect(page.locator('.partner-progress [aria-current="step"]')).toHaveText('Preparing');
    await capture(page, 'partner');
    await b.goto('/profile');
    await expect(b.locator('.profile-role')).toHaveText('Partner B');
    await expect(b.locator('main')).not.toContainText(privateA);
    await b.goto('/partner');
    await expect(b.locator('main')).not.toContainText(privateA);
    expect((await b.request.get(`${API}/fight-sessions/${couple.currentSessionId}`)).status()).toBe(404);
  } finally {
    await contextB.close();
  }
});

test('journal remains accessible before payment while subscription access is preserved', async ({ page }) => {
  await post(page, '/couples', profile);
  const fight = await post<Fight>(page, '/fight-sessions', {});
  expect((await page.request.get(`${API}/journal`)).status()).toBe(402);
  expect((await page.request.get(`${API}/journal/stats`)).status()).toBe(402);
  await page.goto('/journal');
  await expect(page.getByRole('heading', { name: 'Your conversations', exact: true })).toBeVisible();
  await expect(page.locator(`[data-session-id="${fight.sessionId}"]`)).toBeVisible();
  await expect(page.locator('.locked-preview')).toHaveCount(0);
  await page.goto('/stats');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('link', { name: 'Take the About me test', exact: true })).toBeVisible();
  await page.goto('/paywall');
  await expect(page.getByRole('heading', { name: 'Start the talk with a sentence that works.' })).toBeVisible();
  await capture(page, 'paywall');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await completeDemoCheckout(page);
  const updated = await get<Couple>(page, '/couples/me');
  expect(updated.subscription?.status).toBe('active');
  for (const path of ['/journal', '/journal/stats']) expect((await page.request.get(`${API}${path}`)).status()).toBe(200);
  await page.goto('/journal');
  await expect(page.locator(`[data-session-id="${fight.sessionId}"]`)).toBeVisible();
  await expect(page.locator('.locked-preview')).toHaveCount(0);
});
