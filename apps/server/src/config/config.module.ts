import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');
export type AppConfig = Readonly<Env>;

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

let cached: AppConfig | undefined;

/** Конфигурация читается и проверяется один раз при старте процесса. */
export function loadConfig(): AppConfig {
  cached ??= Object.freeze(parseEnv(process.env));
  return cached;
}
