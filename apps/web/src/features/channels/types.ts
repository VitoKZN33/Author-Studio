export type ChannelStatus =
  'detected' | 'active' | 'rights_missing' | 'bot_removed' | 'disconnected';
export type RightKey =
  'canPostMessages' | 'canEditMessages' | 'canDeleteMessages' | 'canInviteUsers';

export interface Channel {
  id: string;
  title: string;
  username: string | null;
  status: ChannelStatus;
  rights: (Record<RightKey, boolean> & { isAdmin: boolean }) | null;
  missingRequired: RightKey[];
  missingRecommended: RightKey[];
  rightsCheckedAt: string | null;
  connectedAt: string | null;
}

export const REQUIRED_RIGHTS: RightKey[] = [
  'canPostMessages',
  'canEditMessages',
  'canDeleteMessages',
];
export const RECOMMENDED_RIGHTS: RightKey[] = ['canInviteUsers'];

/** Группы на экране каналов и порядок их показа. */
export function groupChannels(items: Channel[]) {
  return {
    detected: items.filter((c) => c.status === 'detected'),
    connected: items.filter(
      (c) => c.status === 'active' || c.status === 'rights_missing' || c.status === 'bot_removed',
    ),
    disconnected: items.filter((c) => c.status === 'disconnected'),
  };
}
