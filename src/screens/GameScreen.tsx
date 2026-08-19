import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AttemptState, RoundResult } from '../api/types';
import { getGame } from '../games/registry';
import type { GameHandle } from '../games/types';
import { useAppState } from '../state/AppState';
import { haptic } from '../telegram/webapp';
import { formatCountdown, formatScore } from '../utils/format';

interface Props {
  gameId: string;
  onExit(): void;
}

type Phase = 'loading' | 'no-attempts' | 'playing' | 'finished';

export function GameScreen({ gameId, onExit }: Props) {
  const game = getGame(gameId);
  const { isPro, openPaywall } = useAppState();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<GameHandle | null>(null);
  /** Защита от двойного списания: StrictMode гоняет эффект дважды. */
  const consuming = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [attempts, setAttempts] = useState<AttemptState | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  /** Счёт не дошёл до сервера. Игрок обязан это увидеть. */
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Одна попытка = один раунд. Списываем до старта, а не после. */
  const startRound = useCallback(async () => {
    if (consuming.current) return;
    consuming.current = true;
    setPhase('loading');
    setResult(null);
    setSubmitError(null);
    setScore(0);
    setLevel(1);
    try {
      const state = await api.consumeAttempt(gameId);
      if (!state) {
        setPhase('no-attempts');
        setAttempts(await api.getAttempts(gameId));
        return;
      }
      setAttempts(state);
      setPhase('playing');
    } finally {
      consuming.current = false;
    }
  }, [gameId]);

  useEffect(() => {
    void startRound();
  }, [startRound]);

  // Движок монтируется только в фазе playing, чтобы canvas уже был в DOM.
  useEffect(() => {
    if (phase !== 'playing' || !game?.mount || !canvasRef.current) return;
    const handle = game.mount(canvasRef.current, {
      onScore: setScore,
      onLevel: setLevel,
      onGameOver: async (final) => {
        setPhase('finished');
        setScore(final);
        try {
          setResult(await api.submitScore(gameId, final));
        } catch (e) {
          // Раньше исключение здесь оставляло result пустым, и вместо итога
          // раунда игрок видел пустой экран.
          setSubmitError(e instanceof Error ? e.message : String(e));
        }
      },
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [phase, game, gameId]);

  if (!game) return null;

  const attemptsLabel = attempts?.remaining === null ? '∞' : String(attempts?.remaining ?? '—');

  return (
    <div
      className="game"
      style={{ '--accent': game.accent, '--accent-glow': game.accentGlow } as React.CSSProperties}
    >
      <header className="game__hud">
        <button className="game__back" onClick={onExit} aria-label="Назад">
          ‹
        </button>
        <div className="game__brand">{game.title.toUpperCase()}</div>

        <div className="game__stat">
          <div className="label">Счёт</div>
          <div className="value">{formatScore(score)}</div>
        </div>
        <div className="game__stat">
          <div className="label">{game.levelLabel ?? 'Волна'}</div>
          <div className="value">{level}</div>
        </div>
        <div className="game__stat game__stat--attempts">
          <div className="label">Попытки</div>
          <div className="value">{attemptsLabel}</div>
        </div>
      </header>

      <div className="game__stage">
        {phase === 'playing' && <canvas ref={canvasRef} className="game__canvas" />}

        {phase === 'no-attempts' && (
          <div className="overlay">
            <div className="overlay__emoji">⚡</div>
            <h2 className="overlay__title">
              ПОПЫТКИ
              <br />
              КОНЧИЛИСЬ
            </h2>
            <p className="overlay__text">
              Новые {attempts?.limit ?? 7} — через {attempts ? formatCountdown(attempts.resetsAt) : '…'}
            </p>
            <div className="overlay__actions">
              <button
                className="btn btn--gold"
                onClick={() => openPaywall('Играй без ограничений прямо сейчас')}
              >
                БЕЗЛИМИТ · PRO
              </button>
              <button className="btn btn--ghost" onClick={onExit}>
                К ИГРАМ
              </button>
            </div>
          </div>
        )}

        {phase === 'finished' && submitError && (
          <div className="overlay">
            <div className="overlay__emoji">📡</div>
            <h2 className="overlay__title">Счёт не сохранён</h2>
            <div className="overlay__bignum">{formatScore(score)}</div>
            <p className="overlay__text overlay__text--warn">{submitError}</p>
            <div className="overlay__actions">
              <button className="btn btn--ghost" onClick={onExit}>
                К играм
              </button>
            </div>
          </div>
        )}

        {phase === 'finished' && result && (
          <div className="overlay">
            {/* Латиница — здесь пиксельный шрифт уместен. */}
            <h2 className="overlay__title overlay__title--arcade">
              GAME
              <br />
              OVER
            </h2>
            <div className="overlay__bignum">{formatScore(result.score)}</div>
            {result.counted ? (
              <p className="overlay__text">
                Сумма за сезон: <b>{formatScore(result.seasonTotal)}</b>
              </p>
            ) : (
              <p className="overlay__text overlay__text--warn">
                Раунд не пошёл в зачёт сезона — рейтинг доступен с PRO
              </p>
            )}

            <div className="overlay__actions">
              {!isPro && (
                <button
                  className="btn btn--gold"
                  onClick={() => openPaywall('Твои очки будут идти в турнирный зачёт')}
                >
                  В ТУРНИР
                </button>
              )}
              <button
                className={`btn ${isPro ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => {
                  haptic.tap();
                  void startRound();
                }}
              >
                ↻ ЕЩЁ РАЗ
              </button>
              <button className="btn btn--ghost" onClick={onExit}>
                К ИГРАМ
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="game__strip">
        <span>
          {attempts?.remaining === null
            ? 'Безлимит'
            : `Осталось ${attempts?.remaining ?? 0} из ${attempts?.limit ?? 7}`}
        </span>
        {!isPro && (
          <span>
            <b>PRO</b> — турниры и рейтинг
          </span>
        )}
      </div>
    </div>
  );
}
