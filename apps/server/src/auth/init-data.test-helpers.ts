import { buildDataCheckString, computeInitDataHash } from './init-data.js';

/** Формирует initData так, как это делает Telegram (только для тестов). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const hash = computeInitDataHash(buildDataCheckString(params), botToken).toString('hex');
  params.set('hash', hash);
  return params.toString();
}

export function initDataFor(
  userId: number,
  botToken: string,
  opts: { authDate?: Date; extra?: Record<string, string> } = {},
): string {
  const authDate = Math.floor((opts.authDate ?? new Date()).getTime() / 1000);
  return signInitData(
    {
      query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
      user: JSON.stringify({ id: userId, first_name: 'Тест', username: 'tester' }),
      auth_date: String(authDate),
      ...opts.extra,
    },
    botToken,
  );
}
