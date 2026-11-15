import { expect, type Page } from '@playwright/test';

export const demoCard = {
  name: 'Demo User',
  number: '4242 4242 4242 4242',
  expiry: `12/${String(new Date().getFullYear() + 3).slice(-2)}`,
  cvc: '123',
};

export async function fillDemoCard(page: Page, name = demoCard.name) {
  await page.getByLabel('Cardholder name', { exact: true }).fill(name);
  await page.getByLabel('Card number', { exact: true }).fill(demoCard.number);
  await page.getByLabel('Expiry date', { exact: true }).fill(demoCard.expiry);
  await page.getByLabel('CVC', { exact: true }).fill(demoCard.cvc);
}

export async function completeDemoCheckout(page: Page) {
  await expect(page).toHaveURL(/\/checkout\/demo\?/);
  await expect(page.getByRole('dialog', { name: 'Pay with card' })).toBeVisible();
  await expect(page.getByLabel('Cardholder name', { exact: true })).toHaveValue(demoCard.name);
  await expect(page.getByLabel('Card number', { exact: true })).toHaveValue(demoCard.number);
  await expect(page.getByLabel('Expiry date', { exact: true })).toHaveValue(demoCard.expiry);
  await expect(page.getByLabel('CVC', { exact: true })).toHaveValue(demoCard.cvc);
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is active.', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^(Continue to conversation|Go to your space)$/ }).click();
}
