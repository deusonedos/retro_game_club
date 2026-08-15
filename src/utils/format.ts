export function formatScore(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** «2 д 4 ч», «4 ч 12 м», «12 м» — компактный обратный отсчёт. */
export function formatCountdown(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'вот-вот';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} д ${h % 24} ч`;
  if (h > 0) return `${h} ч ${m % 60} м`;
  return `${m} м`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** «только что», «14 м назад», «3 ч назад», «2 д назад». */
export function formatRelative(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 60_000) return 'только что';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} м назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} д назад`;
}
