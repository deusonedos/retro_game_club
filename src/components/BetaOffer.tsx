import { useState } from 'react';
import { api } from '../api';
import { useAppState } from '../state/AppState';
import { haptic } from '../telegram/webapp';

const BENEFITS = [
  ['♾️', 'Неограниченные попытки'],
  ['🏆', 'Попадание в рейтинг'],
  ['⚔️', 'Участие в турнирах'],
];

/**
 * Оффер беты. PRO не выдаётся автоматически: игрок начинает на FREE и
 * подключает PRO кнопкой.
 *
 * Так это работает не только на бете — нажатие фиксируется как явное согласие
 * с источником 'beta', и когда тариф станет платным, этот список и есть те,
 * кого нужно переводить. Плюс появляется базовая конверсия оффера: сколько
 * людей вообще нажимают, когда бесплатно.
 */
export function BetaOffer() {
  const { profile, isPro, setProfile } = useAppState();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!profile || isPro || profile.betaOfferAccepted || dismissed) return null;

  async function accept() {
    setBusy(true);
    haptic.success();
    setProfile(await api.acceptBetaPro());
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <div className="sheet__handle" />
        <div className="beta__tag">BETA</div>
        <h2 className="sheet__title">RETRO CLUB PRO</h2>
        <p className="sheet__reason">
          Сейчас мы проводим бета-тест, поэтому тариф PRO полностью бесплатный.
        </p>

        <ul className="benefits">
          {BENEFITS.map(([icon, title]) => (
            <li key={title} className="benefits__item">
              <span className="benefits__icon">{icon}</span>
              <div className="benefits__title">{title}</div>
            </li>
          ))}
        </ul>

        <button className="btn btn--gold" onClick={accept} disabled={busy}>
          Перейти на PRO
        </button>
        <button className="btn btn--ghost" onClick={() => setDismissed(true)} disabled={busy}>
          Позже
        </button>
      </div>
    </div>
  );
}
