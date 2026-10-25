import { Suspense } from 'react';
import { AnalyticsScreen } from '@/features/analytics/analytics-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function AnalyticsPage() {
  return (
    <AppShell active="analytics">
      <Suspense>
        <AnalyticsScreen />
      </Suspense>
    </AppShell>
  );
}
