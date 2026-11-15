import { expect, type Page } from '@playwright/test';
import type { Fight } from '../src/api/types';

export async function fightState(page: Page, api: string, id: string): Promise<Fight> {
  const response = await page.request.get(`${api}/fight-sessions/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function answerCurrent(page: Page, api: string, id: string, text?: string, score = 6) {
  const { currentTurn: current } = await fightState(page, api, id);
  if (current?.type !== 'next_turn') throw new Error(`Expected a question, got ${current?.type}`);
  const title = current.stage.startsWith('thermometer')
    ? current.stage === 'thermometer_start' ? 'How upset are you right now?' : 'How upset are you now?'
    : current.stage === 'facts' ? 'What happened? Keep it short.'
      : current.stage === 'rehearsal' ? 'Choose your first sentence.'
        : current.stage === 'ready' ? 'Ready to talk?' : current.agentQuestion;
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  if (current.stage.startsWith('thermometer')) {
    await page.getByRole('slider', { name: 'Upset level, 1 to 10' }).fill(String(score));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else if (current.stage === 'ready') {
    await page.getByRole('button', { name: 'See your plan', exact: true }).click();
  } else if (current.stage === 'rehearsal') {
    await page.getByRole('button', { name: 'Use this', exact: true }).first().click();
    if (text !== undefined) await page.getByLabel('Say it your way', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'I’m ready', exact: true }).click();
  } else if (current.stage === 'facts') {
    await page.getByLabel('Your story', { exact: true }).fill(text ?? 'I washed the dishes alone after dinner and wanted some help.');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else {
    if (text !== undefined) await page.getByLabel('Or in your own words', { exact: true }).fill(text);
    else {
      const option = page.getByRole('button', { name: current.optionLeft, exact: true });
      await option.click();
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      // Choosing a card must not submit before the explicit Next action.
      expect((await fightState(page, api, id)).currentTurn).toMatchObject({ type: 'next_turn', turnIndex: current.turnIndex });
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect.poll(async () => {
    const next = (await fightState(page, api, id)).currentTurn;
    return next?.type !== 'next_turn' || next.turnIndex !== current.turnIndex;
  }).toBeTruthy();
  return current.stage;
}

export async function finishPreparation(page: Page, api: string, id: string, text?: string) {
  for (let index = 0; index < 12; index += 1) {
    const fight = await fightState(page, api, id);
    if (fight.status === 'completed') {
      await expect(page).toHaveURL(new RegExp(`/fight-sessions/${id}/result$`));
      return;
    }
    await answerCurrent(page, api, id, text);
  }
  throw new Error('Preparation did not finish');
}

export async function capturePrototype(page: Page, name: string) {
  for (const [label, width] of [['desktop', 1440], ['mobile', 375]] as const) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `/tmp/kintsugi-prototype-review/prototype-${name}-${label}.png`, fullPage: true, animations: 'disabled' });
  }
}

export async function openPlanFromInsight(page: Page, id: string, capture = false) {
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${id}/insight$`));
  await page.getByRole('link', { name: 'Rehearse your first sentence', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/fight-sessions/${id}/rehearsal$`));
  await expect(page.locator('.rehearsal-options > section')).toHaveCount(2);
  await expect(page.locator('.rehearsal-blur')).toHaveAttribute('aria-hidden', 'true');
  if (capture) await capturePrototype(page, 'rehearsal-preview');
  await page.getByRole('link', { name: 'Unlock your rehearsal', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/paywall' && url.searchParams.get('sessionId') === id);
}
