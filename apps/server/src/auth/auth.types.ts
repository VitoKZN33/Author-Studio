import type { Request } from 'express';

export interface AuthContext {
  sessionId: string;
  userId: string;
  telegramId: bigint;
  role: 'owner';
}

export type AuthenticatedRequest = Request & { auth: AuthContext };
