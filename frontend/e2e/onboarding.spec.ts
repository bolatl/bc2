import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const apiOrigin = 'http://localhost:18080';
const canonicalQuestions = [...readFileSync(new URL('../../docs/features/backend-mvp/FRONTEND_CONTRACT.md', import.meta.url), 'utf8').matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1]);
const accuracyLabels = ['Very inaccurate', 'Moderately inaccurate', 'Neither inaccurate nor accurate', 'Moderately accurate', 'Very accurate'];

test('onboarding requires a choice and limits topics to three distinct values', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: 'How old are you?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();

  for (const answer of ['25–29', 'Dating', '1–3 years', 'No', 'Need some space', 'Feeling heard']) {
    await page.getByRole('radio', { name: answer, exact: true }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'What tends to come between you?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  for (const topic of ['Money', 'Housework', 'Family']) await page.getByRole('checkbox', { name: topic, exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Phones', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Money', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Phones', exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Understanding each other', exact: true }).check();
  const request = page.waitForRequest((req) => req.url() === `${apiOrigin}/api/v1/couples` && req.method() === 'POST');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  expect((await request).postDataJSON()).toEqual({ age: '25-29', relationshipStatus: 'dating', togetherDuration: '1-3', hasKids: 'no', conflictStyle: 'need_space', repairNeed: 'being_heard', fightTopics: ['chores', 'family', 'phone'], goal: 'understand_each_other' });
  await expect(page).toHaveURL(/\/choose$/);
  await expect(page.getByRole('heading', { name: 'Where would you like to start?' })).toBeVisible();
});

test('Mini-IPIP presents canonical order, submits original scores, and shows the real report', async ({ page }) => {
  const create = await page.request.post(`${apiOrigin}/api/v1/couples`, { data: {
    age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no', conflictStyle: 'talk_now', repairNeed: 'plan', fightTopics: ['chores'], goal: 'understand_each_other',
  } });
  expect(create.ok()).toBeTruthy();
  expect(canonicalQuestions).toHaveLength(20);
  await page.goto('/personality');
  const scores = Array.from({ length: 20 }, (_, index) => index % 5 + 1);
  for (let index = 0; index < 20; index += 1) {
    await expect(page.getByRole('heading', { name: canonicalQuestions[index], exact: true })).toBeVisible();
    await page.getByRole('radio', { name: accuracyLabels[scores[index] - 1], exact: true }).check();
    if (index < 19) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  const request = page.waitForRequest((req) => req.url() === `${apiOrigin}/api/v1/personality-tests` && req.method() === 'POST');
  await page.getByRole('button', { name: 'See my profile' }).click();
  expect((await request).postDataJSON()).toEqual({ answers: scores });
  await expect(page).toHaveURL(/\/personality\/result$/);
  await expect(page.getByRole('heading', { name: 'What you bring' })).toBeVisible();
  const reportResponse = await page.request.get(`${apiOrigin}/api/v1/personality-tests/me`);
  expect(reportResponse.ok()).toBeTruthy();
  const report = await reportResponse.json() as { strengths: string[]; tips: string[] };
  expect(report.strengths).toHaveLength(3);
  expect(report.tips).toHaveLength(2);
  for (const text of [...report.strengths, ...report.tips]) await expect(page.getByText(text, { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
  expect(stored).not.toContain('strengths');
  expect(stored).not.toContain('answers');
});
