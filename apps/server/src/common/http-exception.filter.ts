import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Требуется авторизация',
  403: 'Доступ запрещён',
  404: 'Не найдено',
  409: 'Конфликт данных',
  413: 'Слишком большой запрос',
  422: 'Данные не прошли проверку',
  429: 'Слишком много запросов, повторите позже',
  500: 'Внутренняя ошибка сервера',
  503: 'Сервис временно недоступен',
};

export interface ApiErrorBody {
  error: { status: number; message: string; details?: unknown; requestId?: string };
}

/**
 * Единый формат ошибок API. Подробности внутренних ошибок не уходят клиенту:
 * они пишутся в лог с идентификатором запроса, который клиент видит в ответе.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = DEFAULT_MESSAGES[500]!;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const custom =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: unknown }).message
          : undefined;
      // Сообщение исключения показываем, только если оно задано нами на русском.
      message =
        typeof custom === 'string' && /[а-яё]/i.test(custom)
          ? custom
          : (DEFAULT_MESSAGES[status] ?? DEFAULT_MESSAGES[500]!);
      if (typeof body === 'object' && body !== null && 'details' in body) {
        details = (body as { details: unknown }).details;
      }
    } else if (isPayloadTooLarge(exception)) {
      status = 413;
      message = DEFAULT_MESSAGES[413]!;
    } else {
      this.logger.error({ err: exception, requestId }, 'Необработанная ошибка');
    }

    const payload: ApiErrorBody = { error: { status, message, requestId } };
    if (details !== undefined) payload.error.details = details;
    res.status(status).json(payload);
  }
}

function isPayloadTooLarge(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'entity.too.large'
  );
}
