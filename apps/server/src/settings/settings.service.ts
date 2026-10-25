import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import {
  DEFAULT_NOTIFICATION_PREFS,
  installationSettings,
  type NotificationPrefs,
} from '../database/schema.js';

@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const [row] = await this.db
      .select({ prefs: installationSettings.notificationPrefs })
      .from(installationSettings)
      .where(eq(installationSettings.id, 1))
      .limit(1);
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(row?.prefs ?? {}) };
  }

  async setNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const next = { ...(await this.getNotificationPrefs()), ...patch };
    await this.db
      .insert(installationSettings)
      .values({ id: 1, notificationPrefs: next })
      .onConflictDoUpdate({
        target: installationSettings.id,
        set: { notificationPrefs: next, updatedAt: new Date() },
      });
    return next;
  }
}
