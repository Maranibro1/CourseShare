import { expect, test } from '@playwright/test';
import { PHOTO, signIn, signOut, signUp } from './helpers';

test('parent links a child, sets a task and approves the photo', async ({ page }) => {
  await signUp(page, 'Achieng', 'achieng@example.com');
  await page.getByText('As a parent').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: "Link your child's phone" })).toBeVisible();
  const codeEl = page.getByTestId('link-code');
  await expect(codeEl).toHaveAttribute('data-code', /^[A-Z0-9]{6}$/);
  const code = (await codeEl.getAttribute('data-code'))!;
  await expect(page.getByRole('img', { name: 'QR code with the family code' }).locator('svg')).toBeVisible();
  await signOut(page);

  await signUp(page, 'Leo', 'leo@example.com');
  await page.getByText('As a child').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Family code').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Join' }).click();
  await page.getByRole('button', { name: 'Allow Usage access' }).click();
  await page.getByRole('button', { name: 'Allow Accessibility' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByText('No tasks from Achieng yet.')).toBeVisible();
  // Children can't reach the adult screens.
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await signOut(page);

  await signIn(page, 'achieng@example.com');
  await expect(page.getByRole('heading', { name: 'Family' })).toBeVisible();
  await expect(page.getByText('Leo', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Add task for Leo' }).click();
  await page.getByLabel('Task', { exact: true }).fill('Maths homework');
  await page.getByRole('button', { name: 'Scrolls' }).click();
  await page.getByRole('button', { name: '50', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Leo' }).click();
  await expect(page.getByRole('link', { name: /Maths homework/ })).toBeVisible();
  await signOut(page);

  await signIn(page, 'leo@example.com');
  await page.getByRole('link', { name: 'Send photo' }).click();
  await expect(page.getByText('Achieng', { exact: true })).toBeVisible();
  await page.getByTestId('photo-input').setInputFiles(PHOTO);
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByRole('heading', { name: 'Sent to Achieng' })).toBeVisible();
  await expect(page.getByText(/Answer questions instead/)).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to tasks' }).click();
  await expect(page.getByText('Waiting for Achieng')).toBeVisible();
  await signOut(page);

  await signIn(page, 'achieng@example.com');
  await expect(page.getByRole('heading', { name: 'Needs approval' })).toBeVisible();
  await page.getByRole('link', { name: /Maths homework.*Photo from Leo/ }).click();
  await expect(page.getByRole('img', { name: "Leo's photo of Maths homework" })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: 'Needs approval' })).toHaveCount(0);
  await page.getByRole('link', { name: /See week/ }).click();
  await expect(page.getByRole('heading', { name: "Leo's week" })).toBeVisible();
  await page.getByRole('link', { name: "Edit Leo's rules" }).click();
  await page.getByText('No free unlock, only earn scrolls').click();
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByText('Off')).toBeVisible();
  await signOut(page);

  await signIn(page, 'leo@example.com');
  await expect(page.getByText('+50')).toBeVisible();
  await expect(page.getByText('Achieng approved your maths homework.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('scroll-balance')).toHaveText('50');

  // A child with no scrolls left asks the parent for more time instead of an emergency unlock.
  await page.goto('/#/locked/minecraft');
  await expect(page.getByRole('link', { name: 'Emergency unlock' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask Achieng for more time' }).click();
  await expect(page.getByRole('button', { name: 'Waiting for Achieng…' })).toBeDisabled();
  await signOut(page);

  await signIn(page, 'achieng@example.com');
  await page.getByRole('button', { name: 'Give 15 min' }).click();
  await signOut(page);
  await signIn(page, 'leo@example.com');
  await page.goto('/#/screen-time');
  await expect(page.getByText('15 min', { exact: true })).toBeVisible();
});

test('a wrong family code is refused', async ({ page }) => {
  await signUp(page, 'Leo', 'leo2@example.com');
  await page.getByText('As a child').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Family code').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('status')).toHaveText(/doesn.t match/);
});
