import { IS_MOCK_BACKEND } from '../api';
import { PRO_PERIOD, PRO_PRICE_RUB } from '../api/config';
import type { EntitlementSource } from '../api/types';
import { useAppState } from '../state/AppState';
import { isTelegram } from '../telegram/webapp';
import { formatDate } from '../utils/format';

const SOURCE_LABEL: Record<EntitlementSource, string> = {
  beta: 'Бесплатно на время беты',
  admin: 'Выдан вручную',
  tribute: 'Оплачен',
  promo: 'Промо',
};

interface Props {
  onOpenAdmin(): void;
}

export function ProfileScreen({ onOpenAdmin }: Props) {
  const { profile, isPro, isAdmin, openPaywall } = useAppState();

  if (!profile)
    return (
      <div className="screen">
        <div className="muted">Загружаем…</div>
      </div>
    );

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">ПРОФИЛЬ</h1>
      </header>

      <div className="profile__card">
        <div className="profile__avatar">{profile.name.slice(0, 1).toUpperCase() || '?'}</div>
        <div>
          <div className="profile__name">{profile.name || 'Игрок'}</div>
          <div className="profile__handle">
            {profile.username ? `@${profile.username}` : `ID ${profile.userId}`}
          </div>
        </div>
        <span className={`badge${isPro ? ' badge--pro' : ''}`}>{isPro ? 'PRO' : 'FREE'}</span>
      </div>

      <div className="rows">
        <div className="rows__item">
          <span>Telegram ID</span>
          <b>{profile.userId}</b>
        </div>
        <div className="rows__item">
          <span>Баланс</span>
          <b>{profile.coins} 🪙</b>
        </div>
        {isPro && profile.proSource && (
          <div className="rows__item">
            <span>Статус PRO</span>
            <b>{SOURCE_LABEL[profile.proSource]}</b>
          </div>
        )}
        {isPro && profile.proEndsAt && (
          <div className="rows__item">
            <span>Действует до</span>
            <b>{formatDate(profile.proEndsAt)}</b>
          </div>
        )}
        <div className="rows__item">
          <span>Среда</span>
          <b>{isTelegram ? 'Telegram' : 'Браузер (dev)'}</b>
        </div>
      </div>

      {!isPro && (
        <div className="upsell">
          <div className="upsell__title">RETRO CLUB PRO</div>
          <p className="upsell__text">
            На время беты бесплатно. Позже — {PRO_PRICE_RUB} ₽ / {PRO_PERIOD}.
          </p>
          <button className="btn btn--gold" onClick={() => openPaywall('Забери PRO бесплатно')}>
            Подключить
          </button>
        </div>
      )}

      <div className="shop">
        <div className="shop__title">Разовые покупки</div>
        <div className="shop__grid">
          <button className="shop__item" disabled>
            <span>⚡</span>+5 попыток
          </button>
          <button className="shop__item" disabled>
            <span>💣</span>Бустеры
          </button>
          <button className="shop__item" disabled>
            <span>🎨</span>Скины
          </button>
        </div>
        <div className="muted muted--sm">Появится вместе с интеграцией платежей</div>
      </div>

      {isAdmin && (
        <div className="devbox">
          <div className="devbox__title">Администрирование</div>
          <button className="btn btn--secondary" onClick={onOpenAdmin}>
            Открыть админку
          </button>
        </div>
      )}

      {IS_MOCK_BACKEND && (
        <div className="devbox">
          <div className="devbox__title">dev</div>
          <button
            className="btn btn--ghost"
            onClick={() => {
              localStorage.removeItem('rgc.mock.v2');
              location.reload();
            }}
          >
            Сбросить данные
          </button>
        </div>
      )}
    </div>
  );
}
