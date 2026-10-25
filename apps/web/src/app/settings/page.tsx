import { SettingsScreen } from '@/features/settings/settings-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function SettingsPage() {
  return (
    <AppShell active="settings">
      <SettingsScreen />
    </AppShell>
  );
}
