'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../api';

/** Создать пустой черновик и открыть редактор. */
export function useNewPost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const post = await api.post<{ id: string }>('/posts');
      router.push(`/posts/edit/?id=${post.id}`);
    } finally {
      setBusy(false);
    }
  }
  return { create, busy };
}
