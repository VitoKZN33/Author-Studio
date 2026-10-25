import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';

const prefsSchema = z
  .object({
    publishSuccess: z.boolean(),
    publishProblems: z.boolean(),
    integration: z.boolean(),
  })
  .partial()
  .strict();

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('notifications')
  @ApiOperation({ summary: 'Категории уведомлений в боте' })
  notifications() {
    return this.settings.getNotificationPrefs();
  }

  @Put('notifications')
  async setNotifications(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(prefsSchema)) body: z.infer<typeof prefsSchema>,
  ) {
    const prefs = await this.settings.setNotificationPrefs(body);
    await this.audit.record({
      action: 'settings.notifications',
      actorUserId: req.auth.userId,
      metadata: prefs as unknown as Record<string, unknown>,
    });
    return prefs;
  }
}
