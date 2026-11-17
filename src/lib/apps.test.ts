import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPS } from './apps';

describe('lockable apps', () => {
  it('are all visible to the Android app', () => {
    // Since Android 11, the app can only open apps its manifest lists under <queries>.
    const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    const queries = /<queries>([\s\S]*?)<\/queries>/.exec(manifest)?.[1] ?? '';
    const listed = [...queries.matchAll(/android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(APPS.flatMap((a) => a.packages).sort());
  });
});
