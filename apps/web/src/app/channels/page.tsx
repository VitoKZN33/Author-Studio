import { ChannelsScreen } from '@/features/channels/channels-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function ChannelsPage() {
  return (
    <AppShell active="channels">
      <ChannelsScreen />
    </AppShell>
  );
}
