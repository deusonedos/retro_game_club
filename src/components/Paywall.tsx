import { useState } from 'react';
import { api } from '../api';
import { IS_BETA, PRO_PERIOD, PRO_PRICE_RUB, TRIAL_DAYS } from '../api/config';
import { useAppState } from '../state/AppState';
import { haptic, openInvoice } from '../telegram/webapp';

const BENEFITS = [
  ['♾️', 'Неограниченные попытки', 'Играйте сколько хотите, во всех играх каталога'],
  ['🏆', 'Попадание в рейтинг', 'Очки идут в зачёт сезона, вы видите себя в таблице'],
  ['⚔️', 'Участие в турнирах', 'Призовой фонд делят первые три места'],
];

export function Paywall() {
  const { paywallReason, closePaywall, setProfile } = useAppState();
  const [busy, setBusy] = useState(false);

  if (paywallReason === null) return null;

  /** На бете PRO выдаётся кнопкой, платёжка не задействована. */
  async function accept() {
    setBusy(true);
    haptic.success();
    setProfile(await api.acceptBetaPro());
    closePaywall();
  }

  async function subscribe() {
    setBusy(true);
    haptic.tap();
    const { paymentUrl } = await api.startProCheckout();
    openInvoice(paymentUrl, async (status) => {
      if (status === 'paid') {
        setProfile(await api.getProfile());
        closePaywall();
      }
    });
    setBusy(false);
  }

  return (
    <div className="sheet-backdrop" onClick={closePaywall}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        {IS_BETA && <div className="beta__tag">BETA</div>}
        <h2 className="sheet__title">RETRO CLUB PRO</h2>
        <p className="sheet__reason">
          {IS_BETA ? 'Сейчас мы проводим бета-тест, поэтому тариф PRO полностью бесплатный.' : paywallReason}
        </p>

        <ul className="benefits">
          {BENEFITS.map(([icon, title, sub]) => (
            <li key={title} className="benefits__item">
              <span className="benefits__icon">{icon}</span>
              <div>
                <div className="benefits__title">{title}</div>
                <div className="benefits__sub">{sub}</div>
              </div>
            </li>
          ))}
        </ul>

        {IS_BETA ? (
          <>
            <button className="btn btn--gold" onClick={accept} disabled={busy}>
              Перейти на PRO
            </button>
            <p className="sheet__fineprint">
              После беты — {PRO_PRICE_RUB} ₽ / {PRO_PERIOD}. Мы предупредим заранее.
            </p>
          </>
        ) : (
          <>
            <button className="btn btn--gold" onClick={subscribe} disabled={busy}>
              {TRIAL_DAYS} дня бесплатно
            </button>
            <p className="sheet__fineprint">
              Потом {PRO_PRICE_RUB} ₽ / {PRO_PERIOD}. Отменить можно в любой момент в профиле.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
