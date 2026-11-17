import { describe, expect, it } from 'vitest';
import { emptyData } from '../src/lib/logic';
import { PostgresStorage } from './storage';

// Runs when a test database is given, e.g. KAZI_TEST_DATABASE_URL=postgres://kazi@localhost:54329/kazitest
const url = process.env.KAZI_TEST_DATABASE_URL;

describe.skipIf(!url)('Postgres storage', () => {
  it('saves and loads state and photos', async () => {
    const storage = new PostgresStorage(url!);
    try {
      const state = { app: { ...emptyData(), messages: [{ id: 'm1', from: 'a', to: 'b', text: 'hi', at: 1, read: false }] }, sessions: {} };
      await storage.save(state);
      await storage.save({ ...state, sessions: { k: { accountId: 'a', createdAt: 1, lastUsed: 2 } } });
      const loaded = await storage.load();
      expect(loaded?.app.messages[0].text).toBe('hi');
      expect(loaded?.sessions.k.accountId).toBe('a');

      const photo = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
      await storage.putPhoto('t_1', photo);
      expect((await storage.getPhoto('t_1'))?.equals(photo)).toBe(true);
      await storage.deletePhoto('t_1');
      expect(await storage.getPhoto('t_1')).toBeNull();
      await expect(storage.putPhoto('../x', photo)).rejects.toThrow();
    } finally {
      await storage.close();
    }
  });
});
