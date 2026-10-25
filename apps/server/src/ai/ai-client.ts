import type { Agent } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Клиент OpenAI-совместимого API (/chat/completions): DeepSeek, OpenAI, OpenRouter,
 * локальные vLLM/Ollama. Без SDK: нужен один метод, прокси через http.Agent
 * (socks5/http, как у Bot API) и полный контроль над тайм-аутом и повторами.
 */

export type AiErrorCode =
  | 'unauthorized'
  | 'payment_required'
  | 'rate_limited'
  | 'server'
  | 'bad_request'
  | 'not_found'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'empty';

const MESSAGES: Record<AiErrorCode, string> = {
  unauthorized: 'Провайдер отклонил ключ (401/403). Проверьте ключ API.',
  payment_required: 'У провайдера закончились средства или не подключена оплата (402).',
  rate_limited: 'Провайдер ограничил частоту запросов (429). Повторите позже.',
  server: 'Ошибка на стороне провайдера (5xx). Повторите позже.',
  bad_request: 'Провайдер отклонил запрос (400). Проверьте название модели и параметры.',
  not_found: 'Адрес API или модель не найдены (404). Проверьте адрес и модель.',
  timeout: 'Провайдер не ответил вовремя. Увеличьте тайм-аут или повторите.',
  network:
    'Не удалось подключиться к провайдеру. Проверьте адрес API; если провайдер недоступен из страны сервера — включите прокси.',
  bad_response: 'Провайдер вернул ответ в неожиданном формате.',
  empty: 'Провайдер вернул пустой ответ.',
};

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    /** Подробность от провайдера — без ключа (тело ответа обрезано). */
    public readonly detail?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(MESSAGES[code]);
    this.name = 'AiError';
  }

  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'server' || this.code === 'network';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  json?: boolean;
  timeoutMs: number;
  agent?: Agent;
  /** Повторов на 429/5xx/сеть (не больше 2). */
  retries?: number;
  /** Для тестов: базовая задержка между повторами. */
  backoffMs?: number;
}

export interface ChatResult {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Ответ оборван лимитом токенов. */
  truncated: boolean;
}

const MAX_BODY = 4 * 1024 * 1024;

function endpoint(baseUrl: string): URL {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AiError('bad_request', 'адрес должен начинаться с https:// или http://');
  }
  return url;
}

function post(
  url: URL,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  agent?: Agent,
): Promise<{ status: number; text: string; retryAfter: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy(new AiError('bad_response', 'ответ слишком большой'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            retryAfter: res.headers['retry-after'] as string | undefined,
          }),
        );
        res.on('error', reject);
      },
    );
    // Общий тайм-аут на весь запрос, а не только на простой сокета.
    const timer = setTimeout(() => req.destroy(new AiError('timeout')), timeoutMs);
    req.on('timeout', () => req.destroy(new AiError('timeout')));
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e instanceof AiError ? e : new AiError('network', (e as Error).message));
    });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

function providerMessage(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const m =
      typeof j.error === 'string'
        ? j.error
        : typeof j.error?.message === 'string'
          ? j.error.message
          : typeof j.message === 'string'
            ? j.message
            : undefined;
    return m?.slice(0, 300);
  } catch {
    return text ? text.slice(0, 200) : undefined;
  }
}

function classify(status: number, text: string, retryAfter?: string): AiError {
  const detail = providerMessage(text);
  if (status === 401 || status === 403) return new AiError('unauthorized', detail);
  if (status === 402) return new AiError('payment_required', detail);
  if (status === 429) {
    const sec = Number(retryAfter);
    return new AiError(
      'rate_limited',
      detail,
      Number.isFinite(sec) && sec > 0 ? Math.min(sec, 30) * 1000 : undefined,
    );
  }
  if (status === 404) return new AiError('not_found', detail);
  if (status >= 500) return new AiError('server', detail);
  return new AiError('bad_request', detail);
}

function parse(text: string): ChatResult {
  let j: {
    choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new AiError('bad_response', 'ответ не JSON');
  }
  const choice = j.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') throw new AiError('bad_response', 'нет choices[0].message');
  if (!content.trim()) throw new AiError('empty');
  return {
    content,
    promptTokens: j.usage?.prompt_tokens ?? null,
    completionTokens: j.usage?.completion_tokens ?? null,
    truncated: choice?.finish_reason === 'length',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  const url = endpoint(opts.baseUrl);
  const retries = Math.min(opts.retries ?? 2, 2);
  let json = opts.json ?? false;
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${opts.apiKey}`,
  };

  for (let attempt = 0; ; attempt++) {
    const body = JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      stream: false,
    });
    try {
      const res = await post(url, body, headers, opts.timeoutMs, opts.agent);
      if (res.status >= 200 && res.status < 300) return parse(res.text);
      const err = classify(res.status, res.text, res.retryAfter);
      // Часть провайдеров не знает response_format — повторяем один раз без него.
      if (err.code === 'bad_request' && json && /response_format|json/i.test(err.detail ?? '')) {
        json = false;
        attempt--;
        continue;
      }
      throw err;
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('network', (e as Error).message);
      if (!err.retryable || attempt >= retries) throw err;
      await sleep(err.retryAfterMs ?? (opts.backoffMs ?? 1000) * 2 ** attempt);
    }
  }
}

/**
 * Достаёт JSON-объект из ответа модели: целиком, из блока ```json``` или
 * первый сбалансированный {...}. Модели без JSON-режима часто добавляют текст вокруг.
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // следующий вариант
    }
  }
  throw new AiError('bad_response', 'в ответе нет корректного JSON');
}
