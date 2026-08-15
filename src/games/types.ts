export interface GameHooks {
  /** Вызывается при каждом изменении счёта по ходу раунда. */
  onScore(score: number): void;
  /** Игра перешла на новую волну. Не все игры имеют уровни — поле опционально. */
  onLevel?(level: number): void;
  /** Раунд закончен — итоговый счёт уходит на сервер. */
  onGameOver(score: number): void;
}

export interface GameHandle {
  /** Снять слушатели, остановить RAF. Вызывается при размонтировании. */
  destroy(): void;
}

export type GameStatus = 'live' | 'soon';

/**
 * Контракт игры для каталога. Новая игра = новый модуль с этим интерфейсом
 * плюс строка в registry.ts — оболочка не меняется.
 */
export interface GameDefinition {
  id: string;
  title: string;
  tagline: string;
  /** Акцентный цвет карточки и игрового экрана — один из неоновых. */
  accent: string;
  /** Тот же цвет в rgba для свечений (text-shadow / box-shadow). */
  accentGlow: string;
  status: GameStatus;
  mount?(canvas: HTMLCanvasElement, hooks: GameHooks): GameHandle;
}
