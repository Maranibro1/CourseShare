import type { Changes } from './repo';
import { accountKeys, taskKeys } from './repo';

/** Changes in the shape kazi_commit (supabase/schema.sql) expects: rows plus their index keys. */
export function commitPayload(c: Changes) {
  return {
    accounts: c.accounts.map((a) => ({ id: a.id, version: a.version, data: a.data, ...accountKeys(a.data) })),
    tasks: c.tasks.map((t) => ({ id: t.id, version: t.version, data: t.data, ...taskKeys(t.data) })),
    deletedTasks: c.deletedTasks.map((t) => ({ id: t.id, version: t.version })),
    notifications: c.notifications,
    messages: c.messages,
    linkCodes: c.linkCodes,
    deletedCodes: c.deletedCodes,
    timeRequests: c.timeRequests,
  };
}

/** Turns the SQL functions' error messages back into the errors the server expects. */
export function commitError(message: string): Error | null {
  if (message.includes('kazi_conflict')) return new ConflictMarker('conflict');
  if (message.includes('kazi_taken')) return new ConflictMarker('taken');
  return null;
}

export class ConflictMarker extends Error {
  constructor(readonly kind: 'conflict' | 'taken') {
    super(kind);
  }
}
