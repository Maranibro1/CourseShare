import { expect, type Page } from '@playwright/test';

// A tiny valid PNG to stand in for a camera photo.
export const PHOTO = {
  name: 'proof.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgYGD4z8DAwMDAAAAZAAHxBnLLAAAAAElFTkSuQmCC',
    'base64',
  ),
};

export async function signUp(page: Page, name: string, email: string, password = 'password1') {
  await page.goto('/');
  await page.getByRole('link', { name: 'Get started' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email or phone').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'How will you use Kazikwanza?' })).toBeVisible();
}

export async function signIn(page: Page, email: string, password = 'password1') {
  await page.goto('/#/signin');
  await page.getByLabel('Email or phone').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOut(page: Page) {
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Kazikwanza' })).toBeVisible();
}

/** Personal onboarding with no free unlock, so locking doesn't depend on the clock. */
export async function onboardPersonal(page: Page, verifier: string | null) {
  await page.getByText('For myself').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Turn on the app lock' })).toBeVisible();
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('button', { name: 'Lock 6 apps' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock 6 apps' }).click();
  await page.getByText('No free unlock, only earn scrolls').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  if (verifier) {
    await page.getByLabel('Their email or phone').fill(verifier);
    await page.getByRole('button', { name: 'Sister' }).click();
    await page.getByRole('button', { name: 'Send invite' }).click();
  } else {
    await page.getByRole('button', { name: "Skip, I'll use questions for now" }).click();
  }
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

export async function addTask(page: Page, title: string, reward: string, verify: 'photo' | 'questions', kind: 'Scrolls' | 'Screen time' = 'Scrolls') {
  await page.getByRole('link', { name: 'Add task' }).click();
  await page.getByLabel('Task', { exact: true }).fill(title);
  if (kind === 'Screen time') await page.getByRole('button', { name: 'Screen time' }).click();
  await page.getByRole('button', { name: reward, exact: true }).click();
  if (verify === 'photo') await page.getByText(/Send a photo to/).click();
  else await page.getByText('Answer a few questions').click();
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
}
