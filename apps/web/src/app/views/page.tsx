import { ViewsScreen } from '@/features/views/views-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function ViewsPage() {
  return (
    <AppShell active="views">
      <ViewsScreen />
    </AppShell>
  );
}
