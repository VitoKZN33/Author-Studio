import { getTranslations } from 'next-intl/server';
import { SystemStatus } from '@/features/system/system-status';
import { AppShell } from '@/shared/ui/app-shell';

export default async function OverviewPage() {
  const t = await getTranslations('overview');
  return (
    <AppShell active="overview">
      <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-2 mb-5 max-w-prose text-sm text-text-muted">{t('foundationNotice')}</p>
      <SystemStatus />
    </AppShell>
  );
}
