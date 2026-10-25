/**
 * Ограничения Telegram Bot API, используемые для валидации до отправки.
 * Источник и статус проверки каждого значения — docs/TELEGRAM_API_LIMITATIONS.md.
 * Перед этапом 4 значения сверяются с актуальной документацией Bot API.
 */
export const TELEGRAM_LIMITS = {
  messageTextMaxLength: 4096,
  captionMaxLength: 1024,
  mediaGroupMinItems: 2,
  mediaGroupMaxItems: 10,
  photoUploadMaxBytes: 10 * 1024 * 1024,
  fileUploadMaxBytes: 50 * 1024 * 1024,
  fileDownloadMaxBytes: 20 * 1024 * 1024,
} as const;

export type TelegramLimits = typeof TELEGRAM_LIMITS;
