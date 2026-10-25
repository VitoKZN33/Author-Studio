import { HomeScreen } from '@/features/home/home-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function HomePage() {
  return (
    <AppShell active="overview">
      <HomeScreen />
    </AppShell>
  );
}
