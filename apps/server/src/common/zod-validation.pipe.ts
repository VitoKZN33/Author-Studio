import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Валидация тела/параметров на границе API. Ошибки — 400 с перечнем полей. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      message: 'Данные не прошли проверку',
      details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
}
