import { describe, expect, it } from 'vitest';
import { groupChannels, type Channel } from './types';

const ch = (id: string, status: Channel['status']): Channel => ({
  id,
  title: id,
  username: null,
  status,
  rights: null,
  missingRequired: [],
  missingRecommended: [],
  rightsCheckedAt: null,
  connectedAt: null,
});

describe('groupChannels', () => {
  it('раскладывает каналы по группам экрана', () => {
    const g = groupChannels([
      ch('a', 'active'),
      ch('b', 'detected'),
      ch('c', 'rights_missing'),
      ch('d', 'disconnected'),
      ch('e', 'bot_removed'),
    ]);
    expect(g.detected.map((c) => c.id)).toEqual(['b']);
    expect(g.connected.map((c) => c.id)).toEqual(['a', 'c', 'e']);
    expect(g.disconnected.map((c) => c.id)).toEqual(['d']);
  });
});
