import { CalendarScreen } from '@/features/calendar/calendar-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function CalendarPage() {
  return (
    <AppShell active="calendar">
      <CalendarScreen />
    </AppShell>
  );
}
