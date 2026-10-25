import { Suspense } from 'react';
import { EditorScreen } from '@/features/editor/editor-screen';
import { AppShell } from '@/shared/ui/app-shell';

// Статическая сборка: id публикации передаётся в строке запроса (?id=…).
export default function EditPostPage() {
  return (
    <AppShell active="posts">
      <Suspense>
        <EditorScreen />
      </Suspense>
    </AppShell>
  );
}
