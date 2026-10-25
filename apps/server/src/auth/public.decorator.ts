import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Маршрут доступен без сессии (проверки здоровья, вход, webhook Telegram). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
