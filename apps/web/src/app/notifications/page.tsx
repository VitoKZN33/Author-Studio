import { getTranslations } from 'next-intl/server';
import { NotificationSettings } from '@/features/settings/notification-settings';
import { AppShell } from '@/shared/ui/app-shell';
import { PageHeader } from '@/shared/ui/kit';

export default async function NotificationsPage() {
  const t = await getTranslations('notificationsPage');
  return (
    <AppShell active="notifications">
      <div className="flex flex-col gap-4">
        <PageHeader title={t('title')} back={{ href: '/more/', label: t('back') }} />
        <p className="max-w-prose text-sm text-text-muted">{t('intro')}</p>
        <NotificationSettings hideTitle />
      </div>
    </AppShell>
  );
}
