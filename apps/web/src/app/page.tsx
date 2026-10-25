import { getTranslations } from 'next-intl/server';
import { ChannelsSummary } from '@/features/overview/channels-summary';
import { Upcoming } from '@/features/overview/upcoming';
import { SystemStatus } from '@/features/system/system-status';
import { AppShell } from '@/shared/ui/app-shell';

export default async function OverviewPage() {
  const t = await getTranslations('overview');
  return (
    <AppShell active="overview">
      <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1.5 mb-6 max-w-prose text-sm text-text-muted">{t('notice')}</p>
      <div className="flex flex-col gap-4">
        <Upcoming />
        <ChannelsSummary />
        <SystemStatus />
      </div>
    </AppShell>
  );
}
