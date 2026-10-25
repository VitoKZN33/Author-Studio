import { PostsScreen } from '@/features/posts/posts-screen';
import { AppShell } from '@/shared/ui/app-shell';

export default function PostsPage() {
  return (
    <AppShell active="posts">
      <PostsScreen />
    </AppShell>
  );
}
