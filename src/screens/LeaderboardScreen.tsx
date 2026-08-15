import { useEffect, useState } from 'react';
import { api } from '../api';
import { FREE_LEADERBOARD_PREVIEW } from '../api/config';
import type { Leaderboard } from '../api/types';
import { LIVE_GAMES } from '../games/registry';
import { useAppState } from '../state/AppState';
import { formatCountdown, formatScore } from '../utils/format';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardScreen() {
  const { profile, isPro, openPaywall } = useAppState();
  const [gameId, setGameId] = useState(LIVE_GAMES[0]?.id ?? '');
  const [board, setBoard] = useState<Leaderboard | null>(null);

  useEffect(() => {
    if (!gameId) return;
    setBoard(null);
    api.getLeaderboard(gameId).then(setBoard);
  }, [gameId, profile?.tier]);

  // Free видит верхушку таблицы, но не всю: цель — показать, что здесь живо,
  // и не отдать всю ценность бесплатно. Подробности в DECISIONS.md #4.
  const visible = board ? (isPro ? board.entries : board.entries.slice(0, FREE_LEADERBOARD_PREVIEW)) : [];
  const hidden = board ? board.entries.length - visible.length : 0;

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">РЕЙТИНГ</h1>
        {board && <span className="pill">Сезон: {formatCountdown(board.seasonEnd)}</span>}
      </header>

      <div className="segmented">
        {LIVE_GAMES.map((g) => (
          <button
            key={g.id}
            className={`segmented__item${g.id === gameId ? ' is-active' : ''}`}
            onClick={() => setGameId(g.id)}
          >
            {g.title}

          </button>
        ))}
      </div>

      {!board && <div className="muted">Загружаем…</div>}

      {board && (
        <>
          {/* Задел под фазу 5: фонд объявляется в начале сезона (DECISIONS.md §8). */}
          <div className="fund">
            <div>
              <div className="fund__label">Призовой фонд</div>
              <div className="fund__value">
                {board.prizeFund > 0 ? `${board.prizeFund} ₽` : '—'}
              </div>
            </div>
            <div className="fund__note">
              {board.prizeFund > 0
                ? `Делят первые ${board.prizePlaces} места`
                : 'Появится после беты'}
            </div>
          </div>

          <ol className="board">
            {visible.map((e) => (
              <li key={e.userId} className={`board__row${e.isSelf ? ' is-self' : ''}`}>
                <span className="board__rank">{MEDALS[e.rank - 1] ?? e.rank}</span>
                <span className="board__name">{e.name}</span>
                <span className="board__score">{formatScore(e.score)}</span>
              </li>
            ))}
          </ol>

          {!isPro && (
            <div className="locked">
              <div className="locked__blur">
                {board.entries.slice(FREE_LEADERBOARD_PREVIEW, FREE_LEADERBOARD_PREVIEW + 3).map((e) => (
                  <div key={e.userId} className="board__row">
                    <span className="board__rank">{e.rank}</span>
                    <span className="board__name">{e.name}</span>
                    <span className="board__score">{formatScore(e.score)}</span>
                  </div>
                ))}
              </div>
              <div className="locked__cta">
                <div className="locked__title">🔒 ЕЩЁ {hidden}</div>
                <p className="locked__text">
                  Топ-10 сезона делят призовой фонд. Без PRO очки не идут в зачёт и вас нет в таблице.
                </p>
                <button className="btn btn--gold" onClick={() => openPaywall('Попади в турнирную таблицу')}>
                  УЧАСТВОВАТЬ
                </button>
              </div>
            </div>
          )}

          {isPro && (
            <div className="selfrow">
              {board.self ? (
                <>
                  Ваше место: <b>#{board.self.rank}</b> · {formatScore(board.self.score)}
                </>
              ) : (
                'Сыграйте раунд, чтобы попасть в таблицу сезона'
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
