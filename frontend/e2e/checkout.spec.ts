import { expect, test, type Page } from '@playwright/test';
import type { Subscription } from '../src/api/types';
import { demoCard, fillDemoCard } from './checkout-helpers';

const API = 'http://localhost:18080/api/v1';
const profile = {
  age: '30-34', relationshipStatus: 'married', togetherDuration: '3-7', hasKids: 'no',
  conflictStyle: 'talk_now', repairNeed: 'being_heard', fightTopics: ['chores'], goal: 'understand_each_other',
};

async function subscription(page: Page): Promise<Subscription> {
  const response = await page.request.get(`${API}/subscriptions/me`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openPlans(page: Page) {
  expect((await page.request.post(`${API}/couples`, { data: profile })).status()).toBe(201);
  await page.goto('/paywall');
  await expect(page.getByRole('radio', { name: 'Premium', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Premium', exact: true })).toHaveValue('yearly');
}

async function openCheckout(page: Page, plan: 'monthly' | 'yearly' | 'date_night' = 'monthly') {
  await openPlans(page);
  if (plan === 'monthly') await page.getByRole('radio', { name: 'Kintsugi', exact: true }).locator('..').click();
  if (plan === 'date_night') await page.getByRole('radio', { name: 'Date Night', exact: true }).locator('..').click();
  const request = page.waitForRequest(request => request.url() === `${API}/subscriptions/checkout` && request.method() === 'POST');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ plan });
  await expect(page).toHaveURL(/\/checkout\/demo\?/);
  await expect(page.getByLabel('Cardholder name', { exact: true })).toBeVisible();
  return new URL(page.url()).searchParams.get('session_id')!;
}

test('demo card validates locally and activates only the selected plan without sending card fields', async ({ page }) => {
  const checkoutId = await openCheckout(page);
  expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'monthly' });
  await expect(page.getByRole('button', { name: 'Pay $19.99', exact: true })).toBeVisible();
  expect((await page.request.get(`${API}/journal`)).status()).toBe(402);

  const outgoing: string[] = [];
  const confirmations: unknown[] = [];
  page.on('request', request => {
    outgoing.push(`${request.url()} ${request.postData() || ''}`);
    if (request.url() === `${API}/subscriptions/confirm`) confirmations.push(request.postDataJSON());
  });
  const cardholder = 'CHECKOUT_PRIVATE_DEMO_HOLDER';
  await fillDemoCard(page, cardholder);
  for (const [label, value, valid] of [
    ['Cardholder name', '', cardholder],
    ['Card number', '4111 1111 1111 1111', demoCard.number],
    ['Expiry date', '01/20', demoCard.expiry],
    ['CVC', '12', demoCard.cvc],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await page.getByRole('button', { name: /^Pay \$/ }).click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'monthly' });
    expect(confirmations).toHaveLength(0);
    await field.fill(valid);
  }

  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '/tmp/kintsugi-pricing-review/checkout-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '/tmp/kintsugi-pricing-review/checkout-mobile.png', fullPage: true, animations: 'disabled' });

  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API}/subscriptions/confirm`, async route => {
    await pending;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: /^Pay \$/ }).evaluate(element => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await expect.poll(() => confirmations.length).toBe(1);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'Your plan is active.', exact: true })).toBeVisible();
  expect(confirmations).toEqual([{ checkoutSessionId: checkoutId }]);
  expect(await subscription(page)).toMatchObject({ status: 'active', plan: 'monthly' });
  expect((await page.request.get(`${API}/journal`)).status()).toBe(200);

  const stored = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
  const transmitted = outgoing.join('\n');
  for (const value of [cardholder, demoCard.number, demoCard.number.replaceAll(' ', '')]) {
    expect(stored).not.toContain(value);
    expect(transmitted).not.toContain(value);
  }
  expect(transmitted).not.toMatch(/"(?:cardNumber|cardholder|expiry|cvc)"\s*:/i);
  await page.getByRole('link', { name: 'Go to your space', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/profile');
  await expect(page.locator('.profile-plan-status')).toHaveText('Full access is active');
});

test('cancel, resume and reload preserve the standalone Date Night purchase', async ({ page }) => {
  const checkoutId = await openCheckout(page, 'date_night');
  await expect(page.getByRole('button', { name: 'Pay $69.00', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Date Night');
  await fillDemoCard(page, 'PRIVATE_TYPED_NAME');
  await page.reload();
  await expect(page.getByLabel('Cardholder name', { exact: true })).toHaveValue(demoCard.name);
  await expect(page.getByLabel('Card number', { exact: true })).toHaveValue(demoCard.number);
  expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'date_night' });
  await expect(page.getByRole('button', { name: 'Pay $69.00', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/cancel$/);
  await page.getByRole('link', { name: /Resume checkout/ }).click();
  await expect(page.getByRole('radio', { name: 'Date Night', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Premium', exact: true })).not.toBeChecked();
  await expect(page.locator('input[name="plan"]:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Resume checkout', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/checkout/demo' && url.searchParams.get('session_id') === checkoutId);
  await expect(page.getByLabel('Cardholder name', { exact: true })).toHaveValue(demoCard.name);
  expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'date_night' });

  // The old success URL must no longer skip the test-card form for a mock checkout.
  await page.goto(`/checkout/success?session_id=${encodeURIComponent(checkoutId)}&demo=true`);
  await expect(page).toHaveURL(url => url.pathname === '/checkout/demo' && url.searchParams.get('session_id') === checkoutId);
  await expect(page.getByLabel('Cardholder name', { exact: true })).toBeVisible();
  expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'date_night' });
  await page.getByRole('button', { name: 'Pay $69.00', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is active.', exact: true })).toBeVisible();
  expect(await subscription(page)).toMatchObject({ status: 'active', plan: 'date_night' });
});

test('a failed demo activation can be retried without losing the form', async ({ page }) => {
  await openCheckout(page, 'yearly');
  await expect(page.getByRole('button', { name: 'Pay $199.00', exact: true })).toBeVisible();
  await fillDemoCard(page);
  await page.route(`${API}/subscriptions/confirm`, async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'temporarily_unavailable', message: 'Try again in a moment.' }) });
  }, { times: 1 });
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Cardholder name', { exact: true })).toHaveValue(demoCard.name);
  expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'yearly' });
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is active.', exact: true })).toBeVisible();
  expect(await subscription(page)).toMatchObject({ status: 'active', plan: 'yearly' });
});

test('the three offers are mutually exclusive by mouse and keyboard', async ({ page }) => {
  await openPlans(page);
  const plans = page.getByRole('radiogroup', { name: 'Choose your plan' });
  await expect(plans).toContainText('$199');
  await expect(plans).toContainText('$19.99');
  await expect(plans.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Premium billing', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Monthly ·/ })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('$29.99');
  await expect(plans.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Date Night', exact: true }).locator('..')).toContainText('$69');
  await expect(page.locator('main')).not.toContainText('Pre-Wedding');
  await expect(page.locator('main')).not.toContainText('8-week');
  for (const [label, width] of [['desktop', 1440], ['mobile', 375]] as const) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `/tmp/kintsugi-pricing-review/plans-${label}.png`, fullPage: true, animations: 'disabled' });
  }
  for (const [name, price] of [['Kintsugi', '$19.99'], ['Date Night', '$69.00'], ['Premium', '$199.00']] as const) {
    const option = page.getByRole('radio', { name, exact: true });
    await option.locator('..').click();
    await expect(option).toBeChecked();
    await expect(plans.locator('input:checked')).toHaveCount(1);
    await expect(page.locator('.pricing-total strong')).toHaveText(price);
  }
  await page.getByRole('radio', { name: 'Premium', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Kintsugi', exact: true })).toBeChecked();
  await expect(plans.locator('input:checked')).toHaveCount(1);
  await expect(page.locator('.pricing-total strong')).toHaveText('$19.99');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Date Night', exact: true })).toBeChecked();
  await expect(plans.locator('input:checked')).toHaveCount(1);
  await expect(page.locator('.pricing-total strong')).toHaveText('$69.00');
  const request = page.waitForRequest(request => request.url() === `${API}/subscriptions/checkout` && request.method() === 'POST');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ plan: 'date_night' });
  await expect(page.getByRole('button', { name: 'Pay $69.00', exact: true })).toBeVisible();
  expect(await subscription(page)).toMatchObject({ status: 'pending', plan: 'date_night' });
  await page.getByRole('button', { name: 'Pay $69.00', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is active.', exact: true })).toBeVisible();
  expect(await subscription(page)).toMatchObject({ status: 'active', plan: 'date_night' });
});
