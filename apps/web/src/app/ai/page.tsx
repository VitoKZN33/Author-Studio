import { Suspense } from 'react';
import { AiScreen } from '@/features/ai/ai-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function AiPage() {
  return (
    <AppShell active="ai">
      <Suspense>
        <AiScreen />
      </Suspense>
    </AppShell>
  );
}
