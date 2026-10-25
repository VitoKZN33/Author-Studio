export type HealthCheckStatus = 'ok' | 'fail';

export interface HealthCheckResult {
  status: HealthCheckStatus;
  /** Время выполнения проверки, мс. */
  latencyMs?: number;
  /** Описание проблемы на русском, без внутренних подробностей. */
  message?: string;
}

export interface ReadinessReport {
  status: HealthCheckStatus;
  checks: Record<string, HealthCheckResult>;
  timestamp: string;
}

/** Готовность сервиса = все проверки прошли. */
export function aggregateReadiness(
  checks: Record<string, HealthCheckResult>,
  now: Date = new Date(),
): ReadinessReport {
  const status = Object.values(checks).every((c) => c.status === 'ok') ? 'ok' : 'fail';
  return { status, checks, timestamp: now.toISOString() };
}
