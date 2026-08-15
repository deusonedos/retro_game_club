import { createBubbleBlast } from './bubble-blast/engine';
import type { GameDefinition } from './types';

/**
 * Каталог игр. Добавление новой игры = один модуль + одна запись здесь.
 * Слоты со status: 'soon' не кликабельны.
 *
 * `title` обязан быть на латинице: он выводится шрифтом Press Start 2P
 * (карточка каталога и шапка игрового экрана), а кириллицы в этом шрифте нет.
 * Всё русское описание живёт в `tagline` — он набран Rubik.
 */
export const GAMES: GameDefinition[] = [
  {
    id: 'bubble-blast',
    title: 'Bubble Blast',
    tagline: 'Собирай тройки, сноси стену',
    accent: '#28e0ff',
    accentGlow: 'rgba(40,224,255,0.6)',
    status: 'live',
    mount: createBubbleBlast,
  },
  {
    id: 'slot-2',
    title: 'Soon',
    tagline: 'Игра №2 в разработке',
    accent: '#9dff5c',
    accentGlow: 'rgba(157,255,92,0.6)',
    status: 'soon',
  },
  {
    id: 'slot-3',
    title: 'Soon',
    tagline: 'Игра №3 в разработке',
    accent: '#b98cff',
    accentGlow: 'rgba(185,140,255,0.6)',
    status: 'soon',
  },
];

export const getGame = (id: string): GameDefinition | undefined => GAMES.find((g) => g.id === id);

export const LIVE_GAMES = GAMES.filter((g) => g.status === 'live');
