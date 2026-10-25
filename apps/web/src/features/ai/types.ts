import type { MessageEntity } from '@author-studio/shared';

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyMask: string | null;
  useProxy: boolean;
  proxyAvailable: boolean;
  styleGuide: string;
  timeoutSeconds: number;
  maxOutputTokens: number;
  dailyRequestLimit: number;
  monthlyTokenLimit: number | null;
  priceInputPerMillion: number | null;
  priceOutputPerMillion: number | null;
  status: 'not_configured' | 'unchecked' | 'ok' | 'error';
  lastCheckAt: string | null;
  lastError: string | null;
}

export interface AiUsage {
  today: { requests: number; limit: number };
  month: {
    requests: number;
    errors: number;
    input: number;
    output: number;
    tokens: number;
    tokenLimit: number | null;
    estimatedCostRub: number | null;
  };
  timezone: string;
}

export const TEXT_ACTIONS = ['write', 'shorten', 'rewrite', 'fix', 'titles', 'variants'] as const;
export type TextAction = (typeof TEXT_ACTIONS)[number];
export const TONES = ['friendly', 'formal', 'expert', 'casual', 'selling'] as const;
export type Tone = (typeof TONES)[number];

export interface TextVariant {
  text: string;
  entities: MessageEntity[];
  tooLong: boolean;
}

export interface PlanItem {
  date: string;
  time: string | null;
  title: string;
  idea: string;
}

export interface PlanResult {
  from: string;
  to: string;
  timezone: string;
  items: PlanItem[];
  rejected: number;
}

export interface Review {
  period: { days: number; timezone: string; channelTitle: string };
  facts: { label: string; value: string; source: 'telegram' | 'manual' | 'calc' | 'system' }[];
  sufficiency: { level: 'insufficient' | 'low' | 'medium' | 'high'; reasons: string[] };
  ai: {
    observations: string[];
    hypotheses: string[];
    recommendations: string[];
    truncated: boolean;
    model: string;
    unverifiedNumbers: string[];
  } | null;
}

/** Готов ли AI к работе (для кнопок в редакторе). */
export const aiReady = (s: AiSettings | null) => !!s && s.hasKey && s.enabled;

/** Пресеты адресов OpenAI-совместимых API. Модели меняются — поле модели свободное. */
export const PROVIDER_PRESETS = [
  { key: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  { key: 'openai', baseUrl: 'https://api.openai.com/v1', model: '' },
  { key: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
] as const;
