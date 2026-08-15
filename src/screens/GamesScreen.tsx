import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AttemptState } from '../api/types';
import { GAMES } from '../games/registry';
import { useAppState } from '../state/AppState';
import { haptic } from '../telegram/webapp';
import { formatCountdown } from '../utils/format';

interface Props {
  onOpenGame(gameId: string): void;
}

export function GamesScreen({ onOpenGame }: Props) {
  const { profile, isPro, openPaywall } = useAppState();
  const [attempts, setAttempts] = useState<Record<string, AttemptState>>({});

  useEffect(() => {
    const live = GAMES.filter((g) => g.status === 'live');
    Promise.all(live.map((g) => api.getAttempts(g.id))).then((list) => {
      setAttempts(Object.fromEntries(list.map((a) => [a.gameId, a])));
    });
  }, [profile?.tier]);

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">ИГРЫ</h1>
        {!isPro && (
          <button className="pill pill--accent" onClick={() => openPaywall('Открой турниры и безлимит')}>
            PRO
          </button>
        )}
      </header>

      <div className="grid">
        {GAMES.map((game) => {
          const soon = game.status === 'soon';
          const a = attempts[game.id];
          const out = a && a.remaining !== null && a.remaining === 0;

          return (
            <button
              key={game.id}
              className={`card${soon ? ' card--soon' : ''}`}
              style={{ '--accent': game.accent, '--accent-glow': game.accentGlow } as React.CSSProperties}
              disabled={soon}
              onClick={() => {
                haptic.tap();
                onOpenGame(game.id);
              }}
            >
              <div className="card__art" aria-hidden>
                {soon ? '⏳' : '🫧'}
              </div>
              <div className="card__title">{game.title.toUpperCase()}</div>
              <div className="card__tagline">{game.tagline}</div>

              {!soon && (
                <div className={`card__meta${out ? ' is-empty' : ''}`}>
                  {a === undefined
                    ? '…'
                    : a.remaining === null
                      ? '∞ безлимит'
                      : out
                        ? `Сброс через ${formatCountdown(a.resetsAt)}`
                        : `${a.remaining} из ${a.limit} попыток`}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
