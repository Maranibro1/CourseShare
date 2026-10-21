import { expect, test } from '@playwright/test';
import { PHOTO, addTask, onboardPersonal, signIn, signOut, signUp } from './helpers';

test('earn scrolls with questions, then spend them swiping', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, null);
  await expect(page.getByTestId('scroll-balance')).toHaveText('0');
  await expect(page.getByText('No free unlock. Earn every scroll.')).toBeVisible();

  await addTask(page, 'Read 20 pages', '50', 'questions');
  await page.getByRole('link', { name: /Read 20 pages/ }).click();
  await expect(page.getByText('Not started')).toBeVisible();
  await page.getByRole('link', { name: "I'm done, verify it" }).click();

  await expect(page.getByRole('heading', { name: /What did you read/ })).toBeVisible();
  await page.getByLabel('Your answer').fill('Atomic Habits, chapter two');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Your answer').fill('Small daily habits add up over time.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Your answer').fill('Make good habits obvious and easy.');
  const finish = page.getByRole('button', { name: 'Finish' });
  await expect(finish).toBeDisabled();
  await page.getByText('I honestly completed this task').click();
  await finish.click();

  await expect(page.getByText('+50')).toBeVisible();
  await expect(page.getByText('scrolls earned')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('scroll-balance')).toHaveText('50');
  await expect(page.getByText('1 of 1 done')).toBeVisible();

  // Open TikTok and swipe through three posts.
  await page.getByRole('link', { name: 'Open your apps' }).click();
  await page.getByRole('button', { name: 'Open TikTok' }).click();
  const feed = page.getByTestId('feed');
  await expect(page.getByTestId('scroll-meter')).toHaveText('50 scrolls left');
  for (let i = 1; i <= 3; i += 1) {
    await feed.evaluate((el, n) => el.scrollTo({ top: el.clientHeight * n }), i);
    await expect(page.getByTestId('scroll-meter')).toHaveText(`${50 - i} scrolls left`);
  }
  // Scrolling back up doesn't charge again.
  await feed.evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(200);
  await expect(page.getByTestId('scroll-meter')).toHaveText('47 scrolls left');

  await page.goto('/#/wallet');
  await expect(page.getByText('Scrolled TikTok')).toBeVisible();
  await expect(page.getByText('−3', { exact: true })).toBeVisible();
});

test('locked app, emergency unlock and running out of scrolls', async ({ page }) => {
  await page.clock.install();
  await signUp(page, 'Brian', 'brian@example.com');
  await onboardPersonal(page, null);

  await page.goto('/#/apps');
  await page.getByRole('button', { name: 'Open Instagram' }).click();
  await expect(page.getByRole('heading', { name: 'Instagram is locked' })).toBeVisible();
  await page.getByRole('link', { name: 'Emergency unlock' }).click();
  await expect(page.getByText('3 of 3 emergency unlocks left this week')).toBeVisible();
  const unlock = page.getByRole('button', { name: /Unlock in \d+s/ });
  await expect(unlock).toBeDisabled();
  await page.clock.fastForward(61_000);
  await page.getByRole('button', { name: 'Unlock Instagram' }).click();
  await expect(page.getByTestId('scroll-meter')).toHaveText('10 scrolls left');

  const feed = page.getByTestId('feed');
  for (let i = 1; i <= 10; i += 1) {
    await feed.evaluate((el, n) => el.scrollTo({ top: el.clientHeight * n }), i);
    await expect(page.getByTestId('scroll-meter')).toHaveText(`${10 - i} scroll${10 - i === 1 ? '' : 's'} left`);
  }
  await feed.evaluate((el) => el.scrollTo({ top: el.clientHeight * 11 }));
  await expect(page.getByRole('heading', { name: 'Instagram is locked' })).toBeVisible();
  await expect(page.getByText('2 of 3 emergency unlocks left this week')).toHaveCount(0);
  await page.getByRole('link', { name: 'Emergency unlock' }).click();
  await expect(page.getByText('2 of 3 emergency unlocks left this week')).toBeVisible();
});

test('screen time counts down while a game is open', async ({ page }) => {
  await page.clock.install();
  await signUp(page, 'Wanjiru', 'wanjiru@example.com');
  await onboardPersonal(page, null);
  await addTask(page, 'Go to the gym', '10', 'questions', 'Screen time');
  await page.getByRole('link', { name: /Go to the gym/ }).click();
  await page.getByRole('link', { name: "I'm done, verify it" }).click();
  for (const answer of ['Squats and push-ups', 'One hour at the gym', 'Tired but happy']) {
    await page.getByLabel('Your answer').fill(answer);
    const next = page.getByRole('button', { name: /Next|Finish/ });
    if ((await next.textContent()) === 'Finish') await page.getByText('I honestly completed this task').click();
    await next.click();
  }
  await expect(page.getByText('of screen time earned')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('minutes-balance')).toHaveText('10 min');

  await page.goto('/#/apps');
  await page.getByRole('button', { name: 'Open Minecraft' }).click();
  await expect(page.getByTestId('timer')).toHaveText('10:00');
  await page.clock.fastForward(4 * 60_000);
  await expect(page.getByTestId('timer')).toHaveText('6:00');
  await page.getByRole('button', { name: 'Close Minecraft' }).click();
  await expect(page.getByTestId('minutes-balance')).toHaveText('6 min');
  await page.goto('/#/screen-time');
  await expect(page.getByText('4 min')).toBeVisible();
});

test('photo proof is approved by the verifier on the same phone', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, 'emma@example.com');
  await addTask(page, 'Statistics assignment', '100', 'photo');
  await page.getByRole('link', { name: /Statistics assignment/ }).click();
  await expect(page.getByText('Photo to emma@example.com')).toBeVisible();
  await page.getByRole('link', { name: "I'm done, verify it" }).click();
  const send = page.getByRole('button', { name: 'Send for approval' });
  await expect(send).toBeDisabled();
  await page.getByTestId('photo-input').setInputFiles(PHOTO);
  await expect(page.getByRole('img', { name: 'Proof for Statistics assignment' })).toBeVisible();
  await send.click();
  await expect(page.getByRole('heading', { name: 'Sent to emma@example.com' })).toBeVisible();
  await expect(page.getByText(/Answer questions instead in 3h 0m|Answer questions instead in 2h 59m/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to tasks' }).click();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await signOut(page);

  // Emma signs up with the email Sam added and approves.
  await signUp(page, 'Emma', 'Emma@example.com');
  await onboardPersonal(page, null);
  await page.goto('/#/profile');
  await page.getByRole('link', { name: /People I verify for/ }).click();
  await expect(page.getByText('Statistics assignment · just now')).toBeVisible();
  await expect(page.getByRole('img', { name: "Sam's photo of Statistics assignment" })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, 'sam@example.com');
  await expect(page.getByText('+100')).toBeVisible();
  await expect(page.getByText('Emma approved your statistics assignment.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('scroll-balance')).toHaveText('100');
  await page.goto('/#/notifications');
  await expect(page.getByText('Emma approved your statistics assignment. +100 scrolls')).toBeVisible();
});

test('verifier can ask for a redo', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, 'emma@example.com');
  await addTask(page, 'Go to the gym', '20', 'photo');
  await page.getByRole('link', { name: /Go to the gym/ }).click();
  await page.getByRole('link', { name: "I'm done, verify it" }).click();
  await page.getByTestId('photo-input').setInputFiles(PHOTO);
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByRole('heading', { name: 'Sent to emma@example.com' })).toBeVisible();
  await signOut(page);

  await signUp(page, 'Emma', 'emma@example.com');
  await onboardPersonal(page, null);
  await page.goto('/#/requests');
  await page.getByRole('button', { name: 'Ask to redo' }).click();
  await page.getByRole('button', { name: 'Send back' }).click();
  await expect(page.getByText('Asked to redo')).toBeVisible();
  await signOut(page);

  await signIn(page, 'sam@example.com');
  await expect(page.getByText('Redo: The photo was too blurry')).toBeVisible();
  await page.getByRole('link', { name: /Go to the gym/ }).click();
  await expect(page.getByRole('link', { name: 'Send a new photo' })).toBeVisible();
});

test('signing in with the wrong password is refused', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, null);
  await signOut(page);
  await signIn(page, 'sam@example.com', 'wrong-password');
  await expect(page.getByRole('alert')).toHaveText(/don.t match/);
});
