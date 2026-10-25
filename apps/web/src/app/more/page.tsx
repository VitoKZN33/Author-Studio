import { MoreScreen } from '@/features/more/more-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function MorePage() {
  return (
    <AppShell active="more">
      <MoreScreen />
    </AppShell>
  );
}
