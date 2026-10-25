import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  fromAiMarkup,
  TELEGRAM_LIMITS,
  zonedDayKey,
  zonedWallTimeToUtc,
  type PostContent,
} from '@author-studio/shared';
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Agent } from 'node:http';
import type { ZodType } from 'zod';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { maskSecret, SecretBox } from '../crypto/secret-box.js';
import { DB, type Database } from '../database/database.module.js';
import { aiRequests, aiSettings, channelMessages } from '../database/schema.js';
import { PostsService } from '../posts/posts.service.js';
import { createProxyAgent } from '../telegram/telegram-client.js';
import { AiError, chatCompletion, extractJson, type ChatMessage } from './ai-client.js';
import { buildDigest, slotLabel } from './analytics-digest.js';
import {
  analyticsPrompt,
  analyticsResultSchema,
  planItemSchema,
  planPrompt,
  planResultSchema,
  textPrompt,
  textResultSchema,
  unknownNumbers,
  type PlanItem,
  type TextRequest,
} from './prompts.js';

type Kind = 'test' | 'text' | 'plan' | 'analytics';
type SettingsRow = typeof aiSettings.$inferSelect;

export interface AiSettingsPatch {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  /** Новый ключ; пустая строка — удалить ключ; undefined — не менять. */
  apiKey?: string;
  useProxy?: boolean;
  styleGuide?: string;
  timeoutSeconds?: number;
  maxOutputTokens?: number;
  dailyRequestLimit?: number;
  monthlyTokenLimit?: number | null;
  priceInputPerMillion?: number | null;
  priceOutputPerMillion?: number | null;
}

/** AAD привязывает шифртекст к назначению: ключ AI нельзя подставить в другое поле. */
const KEY_AAD = 'ai_settings.api_key';

const ERROR_STATUS: Record<string, number> = {
  unauthorized: 502,
  payment_required: 502,
  rate_limited: 429,
  server: 502,
  bad_request: 502,
  not_found: 502,
  timeout: 504,
  network: 502,
  bad_response: 502,
  empty: 502,
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly box: SecretBox;
  private agent: Agent | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly posts: PostsService,
  ) {
    this.box = new SecretBox(config.APP_ENCRYPTION_KEY);
  }

  // ------------------------------------------------------------ Настройки

  private async row(): Promise<SettingsRow> {
    const [r] = await this.db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
    if (r) return r;
    const [created] = await this.db
      .insert(aiSettings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    return created ?? (await this.row());
  }

  /** Настройки для интерфейса: ключ — только маска. */
  async view() {
    const r = await this.row();
    return {
      enabled: r.enabled,
      baseUrl: r.baseUrl,
      model: r.model,
      hasKey: !!r.apiKeyEncrypted,
      keyMask: r.apiKeyMask,
      useProxy: r.useProxy,
      proxyAvailable: !!this.config.TELEGRAM_PROXY_URL,
      styleGuide: r.styleGuide,
      timeoutSeconds: r.timeoutSeconds,
      maxOutputTokens: r.maxOutputTokens,
      dailyRequestLimit: r.dailyRequestLimit,
      monthlyTokenLimit: r.monthlyTokenLimit,
      priceInputPerMillion: r.priceInputPerMillion,
      priceOutputPerMillion: r.priceOutputPerMillion,
      status: r.status,
      lastCheckAt: r.lastCheckAt?.toISOString() ?? null,
      lastError: r.lastError,
    };
  }

  async update(ownerId: string, patch: AiSettingsPatch) {
    const current = await this.row();
    const { apiKey, ...rest } = patch;
    const set: Partial<SettingsRow> = { ...rest, updatedAt: new Date() };
    if (apiKey !== undefined) {
      const key = apiKey.trim();
      set.apiKeyEncrypted = key ? this.box.encrypt(key, KEY_AAD) : null;
      set.apiKeyMask = key ? maskSecret(key) : null;
    }
    const hasKey = apiKey !== undefined ? !!apiKey.trim() : !!current.apiKeyEncrypted;
    const connectionChanged =
      apiKey !== undefined ||
      (patch.baseUrl !== undefined && patch.baseUrl !== current.baseUrl) ||
      (patch.model !== undefined && patch.model !== current.model) ||
      (patch.useProxy !== undefined && patch.useProxy !== current.useProxy);
    if (!hasKey) set.status = 'not_configured';
    else if (connectionChanged) {
      set.status = 'unchecked';
      set.lastError = null;
    }
    await this.db.update(aiSettings).set(set).where(eq(aiSettings.id, 1));
    await this.audit.record({
      action: 'ai.settings',
      actorUserId: ownerId,
      // Значение ключа в журнал не попадает — только факт изменения.
      metadata: {
        fields: Object.keys(rest),
        apiKey: apiKey === undefined ? 'unchanged' : apiKey.trim() ? 'set' : 'removed',
      },
    });
    return this.view();
  }

  private proxyAgent(useProxy: boolean): Agent | undefined {
    if (!useProxy || !this.config.TELEGRAM_PROXY_URL) return undefined;
    this.agent ??= createProxyAgent(this.config.TELEGRAM_PROXY_URL);
    return this.agent;
  }

  // ------------------------------------------------------------ Лимиты и учёт

  private periodStart(kind: 'day' | 'month'): Date {
    const tz = this.config.APP_TIMEZONE;
    const day = zonedDayKey(new Date(), tz);
    return zonedWallTimeToUtc(`${kind === 'day' ? day : `${day.slice(0, 7)}-01`}T00:00`, tz);
  }

  async usage() {
    const r = await this.row();
    const dayStart = this.periodStart('day');
    const monthStart = this.periodStart('month');
    const [day] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiRequests)
      .where(and(gte(aiRequests.createdAt, dayStart), ne(aiRequests.kind, 'test')));
    const [month] = await this.db
      .select({
        requests: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where not ${aiRequests.ok})::int`,
        input: sql<number>`coalesce(sum(${aiRequests.promptTokens}), 0)::int`,
        output: sql<number>`coalesce(sum(${aiRequests.completionTokens}), 0)::int`,
      })
      .from(aiRequests)
      .where(gte(aiRequests.createdAt, monthStart));
    const m = month ?? { requests: 0, errors: 0, input: 0, output: 0 };
    const cost =
      r.priceInputPerMillion !== null && r.priceOutputPerMillion !== null
        ? Math.round(
            ((m.input * r.priceInputPerMillion + m.output * r.priceOutputPerMillion) / 1e6) * 100,
          ) / 100
        : null;
    return {
      today: { requests: day?.n ?? 0, limit: r.dailyRequestLimit },
      month: {
        ...m,
        tokens: m.input + m.output,
        tokenLimit: r.monthlyTokenLimit,
        estimatedCostRub: cost,
      },
      timezone: this.config.APP_TIMEZONE,
    };
  }

  private async record(
    ownerId: string,
    kind: Kind,
    model: string,
    started: number,
    result:
      { ok: true; prompt: number | null; completion: number | null } | { ok: false; code: string },
  ) {
    await this.db.insert(aiRequests).values({
      ownerId,
      kind,
      model,
      ok: result.ok,
      errorCode: result.ok ? null : result.code,
      promptTokens: result.ok ? result.prompt : null,
      completionTokens: result.ok ? result.completion : null,
      durationMs: Date.now() - started,
    });
  }

  /**
   * Один вызов модели со всеми проверками: включён ли AI, есть ли ключ, лимиты на
   * сутки и месяц. Каждый вызов (успешный или нет) пишется в журнал без текста.
   */
  private async call(
    ownerId: string,
    kind: Kind,
    messages: ChatMessage[],
    opts: { json: boolean; maxTokens?: number },
  ) {
    const r = await this.row();
    if (!r.apiKeyEncrypted)
      throw new ConflictException('AI не настроен: укажите ключ API в настройках AI');
    if (kind !== 'test' && !r.enabled) throw new ConflictException('AI выключен в настройках');

    if (kind !== 'test') {
      const usage = await this.usage();
      if (usage.today.requests >= r.dailyRequestLimit)
        throw new HttpException(
          {
            message: `Достигнут дневной лимит запросов к AI (${r.dailyRequestLimit}). Его можно изменить в настройках AI.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      if (r.monthlyTokenLimit !== null && usage.month.tokens >= r.monthlyTokenLimit)
        throw new HttpException(
          {
            message: `Достигнут месячный лимит токенов (${r.monthlyTokenLimit}). Его можно изменить в настройках AI.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }

    let apiKey: string;
    try {
      apiKey = this.box.decrypt(r.apiKeyEncrypted, KEY_AAD);
    } catch {
      throw new ConflictException(
        'Не удалось расшифровать ключ AI (сменился APP_ENCRYPTION_KEY?). Введите ключ заново.',
      );
    }

    const started = Date.now();
    try {
      const res = await chatCompletion({
        baseUrl: r.baseUrl,
        apiKey,
        model: r.model,
        messages,
        maxTokens: opts.maxTokens ?? r.maxOutputTokens,
        temperature: kind === 'analytics' ? 0.2 : 0.7,
        json: opts.json,
        timeoutMs: r.timeoutSeconds * 1000,
        agent: this.proxyAgent(r.useProxy),
        retries: kind === 'test' ? 0 : 2,
      });
      await this.record(ownerId, kind, r.model, started, {
        ok: true,
        prompt: res.promptTokens,
        completion: res.completionTokens,
      });
      return res;
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('network', (e as Error).message);
      await this.record(ownerId, kind, r.model, started, { ok: false, code: err.code });
      this.logger.warn({ code: err.code, detail: err.detail, kind }, 'Запрос к AI не удался');
      if (
        err.code === 'unauthorized' ||
        err.code === 'payment_required' ||
        err.code === 'not_found'
      ) {
        await this.db
          .update(aiSettings)
          .set({ status: 'error', lastError: err.message, lastCheckAt: new Date() })
          .where(eq(aiSettings.id, 1));
      }
      throw new HttpException(
        { message: err.message, details: { code: err.code, provider: err.detail ?? null } },
        ERROR_STATUS[err.code] ?? 502,
      );
    }
  }

  /** Вызов с ответом JSON по схеме; при неверном формате — одна повторная попытка. */
  private async callJson<T>(
    ownerId: string,
    kind: Kind,
    messages: ChatMessage[],
    schema: ZodType<T>,
  ): Promise<{ value: T; truncated: boolean }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.call(ownerId, kind, messages, { json: true });
      try {
        const parsed = schema.safeParse(extractJson(res.content));
        if (parsed.success) return { value: parsed.data, truncated: res.truncated };
      } catch {
        // JSON не найден — повторяем
      }
      if (res.truncated) break;
    }
    throw new HttpException(
      {
        message:
          'Модель вернула ответ не в том формате. Повторите запрос; если ошибка повторяется — выберите другую модель или увеличьте лимит токенов ответа.',
        details: { code: 'bad_format' },
      },
      502,
    );
  }

  // ------------------------------------------------------------ Проверка подключения

  async test(ownerId: string) {
    const started = Date.now();
    try {
      const res = await this.call(
        ownerId,
        'test',
        [
          { role: 'system', content: 'Ответь одним словом.' },
          { role: 'user', content: 'Напиши слово: готово' },
        ],
        { json: false, maxTokens: 200 },
      );
      await this.db
        .update(aiSettings)
        .set({ status: 'ok', lastError: null, lastCheckAt: new Date() })
        .where(eq(aiSettings.id, 1));
      return {
        ok: true as const,
        ms: Date.now() - started,
        reply: res.content.trim().slice(0, 100),
      };
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() !== 409) {
        const body = e.getResponse() as { message?: string };
        await this.db
          .update(aiSettings)
          .set({ status: 'error', lastError: body.message ?? 'Ошибка', lastCheckAt: new Date() })
          .where(eq(aiSettings.id, 1));
      }
      throw e;
    }
  }

  // ------------------------------------------------------------ Текст поста

  async text(
    ownerId: string,
    req: Omit<TextRequest, 'styleGuide' | 'maxLength'> & { hasMedia: boolean },
  ) {
    if (req.action === 'write' ? !req.topic?.trim() : !req.text.trim())
      throw new BadRequestException(
        req.action === 'write' ? 'Укажите тему поста' : 'В посте нет текста для обработки',
      );
    const r = await this.row();
    const maxLength = req.hasMedia
      ? TELEGRAM_LIMITS.captionMaxLength
      : TELEGRAM_LIMITS.messageTextMaxLength;
    const { value, truncated } = await this.callJson(
      ownerId,
      'text',
      textPrompt({ ...req, maxLength, styleGuide: r.styleGuide }),
      textResultSchema,
    );
    const limit =
      req.action === 'write' ? 2 : req.action === 'titles' ? 5 : req.action === 'variants' ? 3 : 1;
    return {
      truncated,
      variants: value.variants.slice(0, limit).map((v) => {
        const content = fromAiMarkup(v);
        return { ...content, tooLong: content.text.length > maxLength };
      }),
      maxLength,
    };
  }

  // ------------------------------------------------------------ Контент-план

  async plan(
    ownerId: string,
    req: { topic: string; days: number; postsPerWeek: number; channelId?: string },
  ) {
    const r = await this.row();
    const tz = this.config.APP_TIMEZONE;
    const from = zonedDayKey(new Date(Date.now() + 86_400_000), tz);
    let recent: string[] = [];
    let bestSlots: string[] = [];
    if (req.channelId) {
      const c = await this.analytics.channel(ownerId, req.channelId);
      const rows = await this.db
        .select({ summary: channelMessages.summary })
        .from(channelMessages)
        .where(eq(channelMessages.channelId, c.id))
        .orderBy(desc(channelMessages.postedAt))
        .limit(30);
      recent = [
        ...new Set(rows.map((x) => x.summary).filter((s) => s && s !== 'Фото' && s !== 'Видео')),
      ];
      const bt = await this.analytics.bestTime(ownerId, c.id, 90, 'reactions');
      if (bt.best) bestSlots = [`${slotLabel(bt.best.weekday, bt.best.slot)} (${bt.timezone})`];
    }
    if (!req.topic.trim() && recent.length === 0)
      throw new BadRequestException('Опишите тему канала или выберите канал с постами');

    const { value } = await this.callJson(
      ownerId,
      'plan',
      planPrompt({
        topic: req.topic,
        from,
        days: req.days,
        postsPerWeek: req.postsPerWeek,
        recentSummaries: recent,
        bestSlots,
        styleGuide: r.styleGuide,
      }),
      planResultSchema,
    );
    const lastDay = zonedDayKey(
      new Date(zonedWallTimeToUtc(`${from}T12:00`, tz).getTime() + (req.days - 1) * 86_400_000),
      tz,
    );
    const items: PlanItem[] = [];
    let rejected = 0;
    for (const raw of value.items) {
      const p = planItemSchema.safeParse(raw);
      if (!p.success || p.data.date < from || p.data.date > lastDay) {
        rejected++;
        continue;
      }
      items.push({ ...p.data, time: p.data.time ?? null });
    }
    items.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
    if (items.length === 0)
      throw new HttpException(
        {
          message: 'Модель не вернула ни одного подходящего пункта плана. Повторите запрос.',
          details: { code: 'bad_format' },
        },
        502,
      );
    return { from, to: lastDay, timezone: tz, items, rejected };
  }

  /** Черновики из выбранных пунктов плана. Ничего не планирует и не публикует. */
  async createDrafts(ownerId: string, items: { title: string; idea: string }[]) {
    const ids: string[] = [];
    for (const it of items) {
      const title = it.title.trim();
      const content: PostContent = {
        text: `${title}\n\n${it.idea.trim()}`,
        entities: title ? [{ type: 'bold', offset: 0, length: title.length }] : [],
        media: [],
        buttons: [],
        disableLinkPreview: false,
      };
      const post = await this.posts.create(ownerId, content);
      ids.push(post.id);
    }
    return { ids };
  }

  // ------------------------------------------------------------ Разбор аналитики

  async analyticsReview(ownerId: string, channelId: string, days: number) {
    const r = await this.row();
    const overview = await this.analytics.overview(ownerId, channelId, days);
    const posts = await this.analytics.posts(ownerId, channelId, days, 'date');
    const best = await this.analytics.bestTime(ownerId, channelId, days, 'reactions');
    const digest = buildDigest({
      days,
      timezone: this.config.APP_TIMEZONE,
      overview,
      posts,
      bestByReactions: best,
    });
    const base = {
      period: { days, timezone: this.config.APP_TIMEZONE, channelTitle: overview.channel.title },
      facts: digest.facts,
      sufficiency: digest.sufficiency,
    };
    if (digest.sufficiency.level === 'insufficient') return { ...base, ai: null };

    const payload = JSON.stringify(digest.payload);
    const levelRu = { low: 'низкая', medium: 'средняя', high: 'достаточная', insufficient: 'нет' }[
      digest.sufficiency.level
    ];
    const { value, truncated } = await this.callJson(
      ownerId,
      'analytics',
      analyticsPrompt(
        payload,
        `${levelRu}${digest.sufficiency.reasons.length ? ` (${digest.sufficiency.reasons.join('; ')})` : ''}`,
        r.styleGuide,
      ),
      analyticsResultSchema,
    );
    return {
      ...base,
      ai: {
        ...value,
        truncated,
        model: r.model,
        unverifiedNumbers: unknownNumbers(
          [...value.observations, ...value.hypotheses, ...value.recommendations],
          payload,
        ),
      },
    };
  }
}
