import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AdminUserRow, Entitlement } from '../api/types';
import { haptic } from '../telegram/webapp';
import { formatDateTime, formatRelative } from '../utils/format';

const SOURCE_LABEL: Record<string, string> = {
  beta: 'бета',
  admin: 'вручную',
  tribute: 'оплата',
  promo: 'промо',
};

interface Props {
  onExit(): void;
}

export function AdminScreen({ onExit }: Props) {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [history, setHistory] = useState<Entitlement[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    api.adminListUsers().then(setRows);
  }, []);

  async function toggle(row: AdminUserRow) {
    setBusy(row.userId);
    haptic.tap();
    const updated = await api.adminSetTier(row.userId, row.tier === 'pro' ? 'free' : 'pro');
    setRows((prev) => prev?.map((r) => (r.userId === updated.userId ? updated : r)) ?? null);
    if (expanded === row.userId) setHistory(await api.adminUserEntitlements(row.userId));
    setBusy(null);
  }

  async function openHistory(userId: number) {
    if (expanded === userId) {
      setExpanded(null);
      return;
    }
    setExpanded(userId);
    setHistory(await api.adminUserEntitlements(userId));
  }

  const filtered = (rows ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.userId).includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.username ?? '').toLowerCase().includes(q)
    );
  });

  const proCount = (rows ?? []).filter((r) => r.tier === 'pro').length;

  return (
    <div className="screen">
      <header className="screen__head">
        <button className="game__back" onClick={onExit} aria-label="Назад">
          ‹
        </button>
        <h1 className="screen__title">АДМИНКА</h1>
        <span className="pill">
          {rows?.length ?? 0} · PRO {proCount}
        </span>
      </header>

      <input
        className="input"
        placeholder="Поиск по id, имени или @username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!rows && <div className="muted">Загружаем…</div>}

      <div className="admin">
        {filtered.map((row) => (
          <div key={row.userId} className="admin__row">
            <button className="admin__main" onClick={() => openHistory(row.userId)}>
              <div className="admin__id">{row.userId}</div>
              <div className="admin__name">
                {row.name}
                {row.username && <span className="admin__handle"> @{row.username}</span>}
              </div>
              <div className="admin__seen">Заходил {formatRelative(row.lastSeenAt)}</div>
            </button>

            <button
              className={`admin__tier${row.tier === 'pro' ? ' is-pro' : ''}`}
              onClick={() => toggle(row)}
              disabled={busy === row.userId}
            >
              {row.tier === 'pro' ? 'PRO' : 'FREE'}
              {row.proSource && <span className="admin__source">{SOURCE_LABEL[row.proSource]}</span>}
            </button>

            {expanded === row.userId && (
              <div className="admin__history">
                <div className="label">История выдач</div>
                {history.length === 0 && <div className="muted muted--sm">Выдач не было</div>}
                {history.map((e) => (
                  <div key={e.id} className="admin__ent">
                    <span className={`admin__badge admin__badge--${e.source}`}>
                      {SOURCE_LABEL[e.source]}
                    </span>
                    <span>{formatDateTime(e.startsAt)}</span>
                    {e.revokedAt && <span className="admin__revoked">отозвано</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
