'use client';

import { useEffect, useState } from 'react';
import { api } from '@/shared/api';

export interface SystemInfo {
  appName: string;
  timezone: string;
  botUsername: string | null;
  version: string;
}

export function useSystemInfo(): SystemInfo | null {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<SystemInfo>('/system/info')
      .then((r) => !cancelled && setInfo(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
