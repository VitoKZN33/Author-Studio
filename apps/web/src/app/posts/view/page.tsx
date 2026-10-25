import { Suspense } from 'react';
import { PostViewScreen } from '@/features/posts/post-view-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function PostViewPage() {
  return (
    <AppShell active="posts">
      <Suspense>
        <PostViewScreen />
      </Suspense>
    </AppShell>
  );
}
