'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/shared/api';
import type { AiSettings } from './types';

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    api
      .get<AiSettings>('/ai/settings')
      .then((s) => {
        setSettings(s);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiSettings>('/ai/settings')
      .then((s) => !cancelled && setSettings(s))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, setSettings, failed, reload };
}
