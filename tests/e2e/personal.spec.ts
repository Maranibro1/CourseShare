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

test('the Verify tab proves your tasks and checks other people\'s', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, 'emma@example.com');
  await addTask(page, 'Read 20 pages', '50', 'questions');
  await addTask(page, 'Go to the gym', '20', 'photo');

  await page.getByRole('link', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify', exact: true })).toBeVisible();
  await expect(page.getByText('Send a photo to emma@example.com')).toBeVisible();
  await expect(page.getByText('Answer 3 questions')).toBeVisible();
  await expect(page.getByText('No photos waiting.')).toBeVisible();

  // Prove the photo task straight from the tab.
  await page.getByRole('link', { name: 'Prove Go to the gym' }).click();
  await page.getByTestId('photo-input').setInputFiles(PHOTO);
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByRole('heading', { name: 'Sent to emma@example.com' })).toBeVisible();
  await page.goto('/#/verify');
  await expect(page.getByText('Waiting for emma@example.com')).toBeVisible();
  await page.getByRole('button', { name: 'Remind' }).click();
  await expect(page.getByText('Reminder sent to emma@example.com')).toBeVisible();

  // And the questions task.
  await page.getByRole('link', { name: 'Prove Read 20 pages' }).click();
  await expect(page.getByRole('heading', { name: /What did you read/ })).toBeVisible();
  await signOut(page);

  // Emma sees a badge on her Verify tab and checks the photo there.
  await signUp(page, 'Emma', 'emma@example.com');
  await onboardPersonal(page, null);
  const tab = page.getByRole('link', { name: 'Verify, 1 waiting' });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.getByRole('img', { name: "Sam's photo of Go to the gym" })).toBeVisible();
  await page.getByRole('button', { name: 'Ask to redo' }).click();
  await page.getByRole('button', { name: 'Send back' }).click();
  await expect(page.getByText('No photos waiting.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verify', exact: true })).toBeVisible();
  await signOut(page);

  // Sam's tab now flags the redo, which goes back to the camera.
  await signIn(page, 'sam@example.com');
  await page.getByRole('link', { name: 'Verify, 1 waiting' }).click();
  await expect(page.getByText('Redo: The photo was too blurry')).toBeVisible();
  await page.getByRole('link', { name: 'Prove Go to the gym' }).click();
  await expect(page.getByTestId('photo-input')).toBeAttached();
});

test('YouTube: Shorts use scrolls, videos use screen time', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, null);
  await addTask(page, 'Read 20 pages', '50', 'questions');
  await page.getByRole('link', { name: /Read 20 pages/ }).click();
  await page.getByRole('link', { name: "I'm done, verify it" }).click();
  for (const answer of ['Atomic Habits, chapter two', 'Small daily habits add up over time.', 'Make good habits obvious and easy.']) {
    await page.getByLabel('Your answer').fill(answer);
    const next = page.getByRole('button', { name: 'Next' });
    if (await next.isVisible()) await next.click();
  }
  await page.getByText('I honestly completed this task').click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('scroll-balance')).toHaveText('50');

  await page.getByRole('link', { name: 'Open your apps' }).click();
  await page.getByRole('button', { name: 'Open YouTube' }).click();
  await expect(page.getByTestId('mixed-meter')).toHaveText('50 scrolls · 0 min');

  // Shorts: each swipe costs a scroll.
  await page.getByRole('button', { name: 'Watch Shorts' }).click();
  const feed = page.getByTestId('feed');
  for (let i = 1; i <= 2; i += 1) {
    await feed.evaluate((el, n) => el.scrollTo({ top: el.clientHeight * n }), i);
    await expect(page.getByTestId('scroll-meter')).toHaveText(`${50 - i} scrolls left`);
  }
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('mixed-meter')).toHaveText('48 scrolls · 0 min');

  // A regular video needs screen time, which Sam doesn't have, but Shorts still work.
  await page.getByRole('button', { name: 'Watch a video' }).click();
  await expect(page.getByRole('heading', { name: 'YouTube videos are locked' })).toBeVisible();
  await expect(page.getByText('Shorts still work with your scrolls.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open YouTube' })).toBeVisible();

  await page.goto('/#/wallet');
  await expect(page.getByText('Scrolled YouTube')).toBeVisible();
});

test('settings list every app, with how each one is paid for', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, null);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Shorts: scrolls · videos: screen time')).toBeVisible();
  await expect(page.getByText('Apps on your phone')).toBeVisible();
  await expect(page.getByText(/Open Kazikwanza on your Android phone/)).toBeVisible();
  const snapchat = page.getByRole('button', { name: 'Lock Snapchat' });
  await expect(snapchat).toHaveAttribute('aria-pressed', 'false');
  await snapchat.click();
  await expect(snapchat).toHaveAttribute('aria-pressed', 'true');
});

test('an app found on the phone can be locked on screen time', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, null);
  // Stand in for the Android app reporting what's installed on the phone.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => localStorage.getItem(k)?.includes('"accounts"'));
    if (!key) throw new Error('no saved data');
    const data = JSON.parse(localStorage.getItem(key)!);
    data.accounts[data.sessionId].phoneApps = [{ pkg: 'com.roblox.client', name: 'Roblox' }];
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.goto('/#/settings');
  await page.reload();
  const roblox = page.getByRole('button', { name: 'Lock Roblox' });
  await expect(roblox).toHaveAttribute('aria-pressed', 'false');
  await roblox.click();
  await expect(roblox).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/#/apps');
  await page.getByRole('button', { name: 'Open Roblox' }).click();
  await expect(page.getByRole('heading', { name: 'Roblox is locked' })).toBeVisible();
  await expect(page.getByText('Your screen time is used up.')).toBeVisible();
});

test('signing in with the wrong password is refused', async ({ page }) => {
  await signUp(page, 'Sam', 'sam@example.com');
  await onboardPersonal(page, null);
  await signOut(page);
  await signIn(page, 'sam@example.com', 'wrong-password');
  await expect(page.getByRole('alert')).toHaveText(/don.t match/);
});
