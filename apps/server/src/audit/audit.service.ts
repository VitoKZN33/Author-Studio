import { Inject, Injectable } from '@nestjs/common';
import { DB, type Database } from '../database/database.module.js';
import { auditLog } from '../database/schema.js';

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Ключи, которые никогда не попадают в metadata журнала. */
const FORBIDDEN_METADATA_KEYS = /token|secret|password|apikey|api_key|initdata|authorization/i;

export function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_METADATA_KEYS.test(k)) continue;
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v)
        ? sanitizeMetadata(v as Record<string, unknown>)
        : v;
  }
  return out;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: sanitizeMetadata(entry.metadata ?? {}),
    });
  }
}
