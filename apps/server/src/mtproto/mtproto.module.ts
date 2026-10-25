import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { MTPROTO_GATEWAY } from './gateway.js';
import { GramJsGateway } from './gramjs-gateway.js';
import { MtprotoController } from './mtproto.controller.js';
import { MtprotoService } from './mtproto.service.js';
import { MtprotoStore } from './mtproto.store.js';
import { ViewsCollector } from './views-collector.js';

const gateway = {
  provide: MTPROTO_GATEWAY,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => new GramJsGateway(config.TELEGRAM_PROXY_URL),
};

/** API: подключение аккаунта владельца (вход живёт в процессе api). */
@Module({
  controllers: [MtprotoController],
  providers: [gateway, MtprotoStore, MtprotoService],
})
export class MtprotoApiModule {}

/** Worker: сбор просмотров и пересылок по расписанию. */
@Module({ providers: [gateway, MtprotoStore, ViewsCollector] })
export class MtprotoWorkerModule {}
