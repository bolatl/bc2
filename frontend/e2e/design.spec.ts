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

test('sakura follows the server stage, returns on Back, and respects reduced motion', async ({ page }) => {
  await page.goto('/');
  await capture(page, 'landing');
  await post(page, '/couples', profile);
  const id = await start(page);
  const journey = page.locator('.sakura-journey');
  const camera = journey.locator('.journey-camera');
  await expect(journey).toHaveAttribute('data-stage', 'thermometer_start');
  expect(await camera.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
  // Observe the actual fading frames on the mounted question when its step changes.
  await page.locator('.page-content[data-transition-key]').evaluate(element => {
    const observer = new MutationObserver(() => {
      if (element.getAnimations().some(animation => {
        const frames = (animation.effect as KeyframeEffect).getKeyframes();
        return frames.some(frame => Number(frame.opacity) < 1) && frames.some(frame => Number(frame.opacity) === 1);
      })) {
        element.setAttribute('data-observed-question-fade', 'true');
        observer.disconnect();
      }
    });
    observer.observe(element, { attributes: true, attributeFilter: ['data-transition-key'] });
  });
  const initialPosition = await camera.getAttribute('style');
  await answer(page, id);
  await expect(journey).toHaveAttribute('data-stage', 'facts');
  await expect(page.locator('.page-content[data-transition-key]')).toHaveAttribute('data-observed-question-fade', 'true');
  const factsPosition = await camera.getAttribute('style');
  expect(factsPosition).not.toBe(initialPosition);
  await answer(page, id, 'I would like us to share the evening chores.');
  await expect(journey).toHaveAttribute('data-stage', 'feelings');
  expect(await camera.getAttribute('style')).not.toBe(factsPosition);
  await capture(page, 'journey');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(journey).toHaveAttribute('data-stage', 'facts');
  expect(await camera.getAttribute('style')).toBe(factsPosition);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await answer(page, id, 'I would like to agree on a fair plan for chores.');
  await expect(journey).toHaveAttribute('data-stage', 'feelings');
  await expect(camera).toHaveCSS('transition-duration', '0s');
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
    await expect(page.getByRole('heading', { name: 'Your words are ready.', exact: true })).toBeVisible();
    await capture(page, 'home');
    await page.locator('.personal-home-links a[href="/profile"]').click();
    await expect(page.getByRole('heading', { name: 'Your space, made personal.', exact: true })).toBeVisible();
    await expect(page.locator('.profile-role')).toHaveText('Partner A');
    await expect(page.locator('.profile-plan-status')).toHaveText('Full access is active');
    await expect(page.locator('main')).not.toContainText(privateB);
    await capture(page, 'profile');
    await page.getByRole('link', { name: 'Your conversations', exact: true }).click();
    await page.locator('.space-switch a[href="/partner"]').click();
    await expect(page.getByRole('heading', { name: 'Two perspectives. Room for both.', exact: true })).toBeVisible();
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

test('subscription previews stay blurred and inactive until a real mock checkout unlocks access', async ({ page }) => {
  await post(page, '/couples', profile);
  for (const [path, variant, apiPath] of [['/journal', 'journal', '/journal'], ['/stats', 'patterns', '/journal/stats']] as const) {
    expect((await page.request.get(`${API}${apiPath}`)).status()).toBe(402);
    await page.goto(path);
    const preview = page.locator(`.locked-preview-${variant}`);
    await expect(preview).toBeVisible();
    await expect(preview.locator('.locked-preview-skeleton')).toHaveAttribute('inert', '');
    await expect(preview.locator('.locked-preview-skeleton')).toHaveAttribute('aria-hidden', 'true');
    await expect(preview.locator('.locked-preview-skeleton')).toHaveCSS('filter', 'blur(6px)');
    await expect(preview.locator('.locked-preview-content')).toHaveCSS('filter', 'none');
    await preview.locator('a[href="/paywall"]').click();
    await expect(page).toHaveURL(/\/paywall$/);
  }
  await expect(page.getByRole('heading', { name: 'Start the talk with a sentence that works.' })).toBeVisible();
  await capture(page, 'paywall');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await completeDemoCheckout(page);
  await expect(page).toHaveURL(/\/home$/);
  const updated = await get<Couple>(page, '/couples/me');
  expect(updated.subscription?.status).toBe('active');
  for (const [path, apiPath] of [['/journal', '/journal'], ['/stats', '/journal/stats']] as const) {
    expect((await page.request.get(`${API}${apiPath}`)).status()).toBe(200);
    await page.goto(path);
    await expect(page.locator('.locked-preview')).toHaveCount(0);
    await expect(page.locator('main')).toContainText(/conversation/i);
  }
});
