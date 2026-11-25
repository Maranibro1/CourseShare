import { expect, test, type Browser, type Page } from '@playwright/test';
import { PHOTO, onboardPersonal, proofPhoto, signIn, signUp } from './helpers';

/** A fresh browser context is a separate phone: its own storage, its own sign-in. */
async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test('verifier on another phone sees the photo live, messages, and approves', async ({ browser }) => {
  const id = Date.now();
  const samEmail = `sam${id}@example.com`;
  const emmaEmail = `emma${id}@example.com`;
  const sam = await phone(browser);
  const emma = await phone(browser);

  await signUp(sam, 'Sam', samEmail);
  await onboardPersonal(sam, emmaEmail);
  await signUp(emma, 'Emma', emmaEmail);
  await onboardPersonal(emma, null);

  // Emma sees Sam under "People I verify for" before any photo arrives.
  await emma.getByRole('link', { name: 'People I verify for' }).click();
  await expect(emma.getByRole('heading', { name: 'People I verify for' })).toBeVisible();
  await expect(emma.getByText('Sam', { exact: true })).toBeVisible();
  await emma.goBack();

  // Sam sends a photo task from his phone.
  await sam.getByRole('link', { name: 'Add task' }).click();
  await sam.getByLabel('Task', { exact: true }).fill('Statistics assignment');
  await sam.getByRole('button', { name: '100', exact: true }).click();
  await sam.getByText(/Send a photo to Emma/).click();
  await sam.getByRole('button', { name: 'Add task' }).click();
  await sam.getByRole('link', { name: /Statistics assignment/ }).click();
  await sam.getByRole('link', { name: "I'm done, verify it" }).click();
  await sam.getByTestId('photo-input').setInputFiles(PHOTO);
  await sam.getByRole('button', { name: 'Send for approval' }).click();
  await expect(sam.getByRole('heading', { name: 'Sent to Emma' })).toBeVisible();

  // Emma's header updates on its own (no reload) with a badge.
  await expect(emma.getByRole('link', { name: 'People I verify for, 1 photo to check' })).toBeVisible({ timeout: 15_000 });
  await emma.getByRole('link', { name: /People I verify for/ }).click();
  await expect(emma.getByRole('img', { name: "Sam's photo of Statistics assignment" })).toBeVisible();

  // Emma messages Sam from the request.
  await emma.getByRole('link', { name: 'Message Sam' }).first().click();
  await emma.getByLabel('Message Sam').fill('Is question 4 finished too?');
  await emma.getByRole('button', { name: 'Send' }).click();
  await expect(emma.locator('.bubble.mine')).toHaveText(/Is question 4 finished too\?/);

  // Sam gets it live on his phone.
  await sam.getByRole('link', { name: 'Message Emma' }).click();
  await expect(sam.locator('.bubble').filter({ hasText: 'Is question 4 finished too?' })).toBeVisible({ timeout: 15_000 });
  await sam.getByLabel('Message Emma').fill('Yes, all of it');
  await sam.getByLabel('Message Emma').press('Enter');
  await expect(emma.locator('.bubble').filter({ hasText: 'Yes, all of it' })).toBeVisible({ timeout: 15_000 });
  // Emma has read it, so Sam sees "Seen".
  await expect(sam.locator('.bubble.mine').filter({ hasText: 'Yes, all of it' })).toContainText('Seen', { timeout: 15_000 });

  // Emma approves on her phone; Sam's balance updates on his.
  await emma.getByRole('button', { name: 'Back' }).click();
  await emma.getByRole('button', { name: 'Approve' }).click();
  await expect(emma.getByText('Approved', { exact: true })).toBeVisible();
  await sam.goto('/#/home');
  await expect(sam.getByText('Emma approved your statistics assignment.')).toBeVisible({ timeout: 15_000 });
  await sam.getByRole('button', { name: 'Done' }).click();
  await expect(sam.getByTestId('scroll-balance')).toHaveText('100');

  // A third person can't see any of it.
  const mallory = await phone(browser);
  await signUp(mallory, 'Mallory', `mallory${id}@example.com`);
  await onboardPersonal(mallory, null);
  await mallory.goto('/#/messages');
  await expect(mallory.getByText(/Add a verifier or link your child/)).toBeVisible();
  await mallory.goto(`/#/messages/${await sam.evaluate(() => JSON.parse(localStorage.getItem('kazikwanza:server-cache')!).sessionId)}`);
  await expect(mallory.getByRole('heading', { name: "Can't message this person" })).toBeVisible();
});

test('parent and child on separate phones', async ({ browser }) => {
  const id = Date.now();
  const mum = await phone(browser);
  const leo = await phone(browser);

  await signUp(mum, 'Achieng', `achieng${id}@example.com`);
  await mum.getByText('As a parent').click();
  await mum.getByRole('button', { name: 'Continue' }).click();
  const codeEl = mum.getByTestId('link-code');
  await expect(codeEl).toHaveAttribute('data-code', /^[A-Z0-9]{6}$/);
  const code = (await codeEl.getAttribute('data-code'))!;

  await signUp(leo, 'Leo', `leo${id}@example.com`);
  await leo.getByText('As a child').click();
  await leo.getByRole('button', { name: 'Continue' }).click();
  await leo.getByLabel('Family code').fill(code);
  await leo.getByRole('button', { name: 'Join' }).click();
  await expect(leo.getByRole('heading', { name: 'Turn on the app lock' })).toBeVisible();
  await leo.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(leo.getByRole('heading', { name: 'My tasks' })).toBeVisible();

  // The parent's link screen notices the child joined on the other phone.
  await expect(mum.getByRole('heading', { name: 'Family' })).toBeVisible({ timeout: 15_000 });
  await mum.getByRole('link', { name: 'Add task for Leo' }).click();
  await mum.getByLabel('Task', { exact: true }).fill('Maths homework');
  await mum.getByRole('button', { name: 'Scrolls' }).click();
  await mum.getByRole('button', { name: '50', exact: true }).click();
  await mum.getByRole('button', { name: 'Send to Leo' }).click();

  await expect(leo.getByText('Maths homework')).toBeVisible({ timeout: 15_000 });
  await leo.getByRole('link', { name: 'Send photo' }).click();
  await leo.getByTestId('photo-input').setInputFiles(PHOTO);
  await leo.getByRole('button', { name: 'Send for approval' }).click();
  await expect(leo.getByRole('heading', { name: 'Sent to Achieng' })).toBeVisible();

  await expect(mum.getByRole('heading', { name: 'Needs approval' })).toBeVisible({ timeout: 15_000 });
  await mum.getByRole('link', { name: /Maths homework.*Photo from Leo/ }).click();
  await expect(mum.getByRole('img', { name: "Leo's photo of Maths homework" })).toBeVisible();
  await mum.getByRole('button', { name: 'Approve' }).click();

  await leo.goto('/#/child');
  await expect(leo.getByText('Achieng approved your maths homework.')).toBeVisible({ timeout: 15_000 });
  await leo.getByRole('button', { name: 'Done' }).click();
  await expect(leo.getByTestId('scroll-balance')).toHaveText('50');

  // Leo messages his mum.
  await leo.getByRole('link', { name: 'Messages' }).click();
  await leo.getByRole('link', { name: /Achieng/ }).click();
  await leo.getByLabel('Message Achieng').fill('Done with homework!');
  await leo.getByRole('button', { name: 'Send' }).click();
  await mum.goto('/#/family');
  await expect(mum.getByRole('link', { name: 'Messages, 1 unread message' })).toBeVisible({ timeout: 15_000 });
});

test('welcome screen offers the Android download and iPhone steps', async ({ browser }, testInfo) => {
  const android = await phone(browser);
  await android.goto('/');
  const download = android.getByRole('link', { name: 'Download for Android' });
  await expect(download).toHaveAttribute('href', '/downloads/kazikwanza.apk');
  const res = await android.request.get('/downloads/kazikwanza.apk');
  expect(res.status()).toBe(200);
  // The Node server labels the file so phones offer to install it (only it serves the APK itself).
  if (testInfo.project.name === 'sync') expect(res.headers()['content-type']).toBe('application/vnd.android.package-archive');

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const iphone = await context.newPage();
  await iphone.goto('/');
  await expect(iphone.getByRole('link', { name: 'Download for Android' })).toHaveCount(0);
  await iphone.getByRole('button', { name: 'Add to Home Screen' }).click();
  await expect(iphone.getByRole('dialog', { name: 'Add Kazikwanza to your Home Screen' })).toBeVisible();
});

test('stays signed in after reopening the app', async ({ browser }) => {
  const id = Date.now();
  const p = await phone(browser);
  await signUp(p, 'Brian', `brian${id}@example.com`);
  await onboardPersonal(p, null);
  await p.reload();
  await expect(p.getByRole('heading', { name: 'Today' })).toBeVisible();

  // Two quick changes in a row both reach the server (the second builds on the first).
  await p.goto('/#/settings');
  await p.getByRole('button', { name: 'Lock X' }).click();
  await p.getByRole('button', { name: 'Lock Snapchat' }).click();
  await expect(p.getByRole('button', { name: 'Lock Snapchat' })).toHaveAttribute('aria-pressed', 'true');
  await p.waitForTimeout(1500);
  await p.reload();
  await expect(p.getByRole('button', { name: 'Lock X' })).toHaveAttribute('aria-pressed', 'true');
  await expect(p.getByRole('button', { name: 'Lock Snapchat' })).toHaveAttribute('aria-pressed', 'true');
});

test('Claude checks a photo straight away, and grades question answers', async ({ browser }) => {
  const sam = await phone(browser);
  await signUp(sam, 'Sam', `sam.claude${Date.now()}@example.com`);
  await onboardPersonal(sam, null);

  // A good photo: approved in seconds, scrolls paid.
  await sam.getByRole('link', { name: 'Add task' }).click();
  await sam.getByLabel('Task', { exact: true }).fill('Clean my room');
  await sam.getByRole('button', { name: '50', exact: true }).click();
  await sam.getByText('Send a photo to Claude (checked straight away)').click();
  await sam.getByRole('button', { name: 'Add task' }).click();
  await sam.getByRole('link', { name: /Clean my room/ }).click();
  await expect(sam.getByText('Photo checked by Claude')).toBeVisible();
  await sam.getByRole('link', { name: "I'm done, verify it" }).click();
  await sam.getByTestId('photo-input').setInputFiles(PHOTO);
  await sam.getByRole('button', { name: 'Check with Claude' }).click();
  await expect(sam.getByText('Claude approved your clean my room.')).toBeVisible();
  await sam.getByRole('button', { name: 'Done' }).click();
  await expect(sam.getByTestId('scroll-balance')).toHaveText('50');

  // A photo Claude isn't happy with comes back with its reason.
  await sam.getByRole('link', { name: 'Add task' }).click();
  await sam.getByLabel('Task', { exact: true }).fill('Messy desk');
  await sam.getByRole('button', { name: '20', exact: true }).click();
  await sam.getByText('Send a photo to Claude (checked straight away)').click();
  await sam.getByRole('button', { name: 'Add task' }).click();
  await sam.getByRole('link', { name: /Messy desk/ }).click();
  await sam.getByRole('link', { name: "I'm done, verify it" }).click();
  await sam.getByTestId('photo-input').setInputFiles(PHOTO);
  await sam.getByRole('button', { name: 'Check with Claude' }).click();
  await expect(sam.getByText('The room still looks messy. Tidy the bed and floor, then try again.')).toBeVisible();
  await expect(sam.getByRole('button', { name: 'Check with Claude' })).toBeDisabled();

  // Questions: Claude reads the answers.
  await sam.goto('/#/home');
  await sam.getByRole('link', { name: 'Add task' }).click();
  await sam.getByLabel('Task', { exact: true }).fill('Read 20 pages');
  await sam.getByRole('button', { name: '50', exact: true }).click();
  await sam.getByText('Answer a few questions (Claude reads them)').click();
  await sam.getByRole('button', { name: 'Add task' }).click();
  await sam.getByRole('link', { name: /Read 20 pages/ }).click();
  await sam.getByRole('link', { name: "I'm done, verify it" }).click();
  await proofPhoto(sam);
  const answer = async (texts: string[]) => {
    for (const [i, t] of texts.entries()) {
      await sam.getByLabel('Your answer').fill(t);
      if (i < texts.length - 1) await sam.getByRole('button', { name: 'Next' }).click();
    }
    const honest = sam.getByText('I honestly completed this task');
    if (!(await sam.getByRole('checkbox').isChecked().catch(() => false))) await honest.click();
    await sam.getByRole('button', { name: 'Finish' }).click();
  };
  await answer(['I dunno, some book really', 'Something about habits', 'Not sure what I learned']);
  await expect(sam.getByText('Tell me which book and chapter you read.')).toBeVisible();
  await answer(['Atomic Habits, chapter two', 'Small daily habits add up over time.', 'Make good habits obvious and easy.']);
  await expect(sam.getByText('+50')).toBeVisible();
});

test('pick a verifier by @username, and sign in with a username', async ({ browser }) => {
  const id = Date.now();
  const emmaEmail = `emma.u${id}@example.com`;
  const emma = await phone(browser);
  await signUp(emma, 'Emma', emmaEmail);
  await onboardPersonal(emma, null);
  await emma.getByRole('link', { name: 'Verify', exact: true }).click();
  const emmaName = (await emma.getByTestId('my-username').textContent())!.trim();

  const sam = await phone(browser);
  await signUp(sam, 'Sam', `sam.u${id}@example.com`);
  await onboardPersonal(sam, null);
  await sam.getByRole('link', { name: 'Verify', exact: true }).click();
  await expect(sam.getByText('You, with a photo and questions')).toBeVisible();
  await sam.getByLabel("Verifier's username").fill(emmaName);
  await sam.getByRole('button', { name: 'Ask' }).click();
  await expect(sam.getByText(`Emma (${emmaName})`)).toBeVisible();

  // Sam sends a photo; Emma checks it on her own phone.
  await sam.goto('/#/home');
  await sam.getByRole('link', { name: 'Add task' }).click();
  await sam.getByLabel('Task', { exact: true }).fill('Wash the car');
  await sam.getByRole('button', { name: '20', exact: true }).click();
  await sam.getByText(/Send a photo to Emma/).click();
  await sam.getByRole('button', { name: 'Add task' }).click();
  await sam.getByRole('link', { name: /Wash the car/ }).click();
  await sam.getByRole('link', { name: "I'm done, verify it" }).click();
  await sam.getByTestId('photo-input').setInputFiles(PHOTO);
  await sam.getByRole('button', { name: 'Send for approval' }).click();
  await expect(sam.getByRole('heading', { name: 'Sent to Emma' })).toBeVisible();

  await emma.reload();
  await emma.getByRole('link', { name: /Verify, 1 waiting/ }).click();
  await emma.getByRole('button', { name: 'Approve' }).click();
  await expect(emma.getByText('No photos waiting.')).toBeVisible();

  // Emma signs in again with just her username.
  const again = await phone(browser);
  await signIn(again, emmaName.slice(1));
  await expect(again.getByRole('heading', { name: 'Today' })).toBeVisible();
});

test('a friend reviews a self-checked task and disallows it', async ({ browser }) => {
  const id = Date.now();
  const emma = await phone(browser);
  await signUp(emma, 'Emma', `emma.r${id}@example.com`);
  await onboardPersonal(emma, null);
  await emma.getByRole('link', { name: 'Verify', exact: true }).click();
  const emmaName = (await emma.getByTestId('my-username').textContent())!.trim();

  const sam = await phone(browser);
  await signUp(sam, 'Sam', `sam.r${id}@example.com`);
  await onboardPersonal(sam, null);
  await sam.getByRole('link', { name: 'Verify', exact: true }).click();
  await sam.getByLabel("Verifier's username").fill(emmaName);
  await sam.getByRole('button', { name: 'Ask' }).click();
  // Sam lets Emma review his self-checked tasks.
  await sam.goto('/#/profile');
  await sam.getByRole('button', { name: 'Let my verifier review my self-checked tasks' }).click();

  // Sam checks a task himself, with a photo and answers.
  await sam.goto('/#/home');
  await sam.getByRole('link', { name: 'Add task' }).click();
  await sam.getByLabel('Task', { exact: true }).fill('Read 20 pages');
  await sam.getByRole('button', { name: '50', exact: true }).click();
  await sam.getByText(/^Answer a few questions/).click();
  await sam.getByRole('button', { name: 'Add task' }).click();
  await sam.getByRole('link', { name: /Read 20 pages/ }).click();
  await sam.getByRole('link', { name: "I'm done, verify it" }).click();
  await proofPhoto(sam);
  for (const [i, t] of ['Atomic Habits, chapter two', 'Small daily habits add up over time.', 'Make good habits obvious and easy.'].entries()) {
    await sam.getByLabel('Your answer').fill(t);
    if (i < 2) await sam.getByRole('button', { name: 'Next' }).click();
  }
  await sam.getByText('I honestly completed this task').click();
  await sam.getByRole('button', { name: 'Finish' }).click();
  await expect(sam.getByText('+50')).toBeVisible();
  await sam.getByRole('button', { name: 'Done' }).click();
  await expect(sam.getByTestId('scroll-balance')).toHaveText('50');

  // Emma opens Sam's task history from "People I verify for" and disallows it.
  await emma.goto('/#/requests');
  await emma.reload();
  await emma.getByRole('link', { name: "Sam's task history" }).click();
  await expect(emma.getByText('Atomic Habits, chapter two')).toBeVisible();
  await expect(emma.getByRole('img', { name: 'Photo of Read 20 pages' })).toBeVisible();
  await emma.getByRole('button', { name: 'Disallow' }).click();
  await emma.getByLabel('Why').fill('Show me the page you got to');
  await emma.getByRole('button', { name: 'Disallow' }).last().click();
  await expect(emma.getByText('Disallowed', { exact: true })).toBeVisible();

  // Sam loses the 50 scrolls and sees why.
  await sam.reload();
  await expect(sam.getByTestId('scroll-balance')).toHaveText('0');
  await sam.goto('/#/history');
  await expect(sam.getByText(/disallowed this: Show me the page you got to/)).toBeVisible();
});
