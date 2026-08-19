import { createBubbleBlast } from './bubble-blast/engine';
import { createNeonDrive } from './neon-drive/engine';
import { createNeonTower } from './neon-tower/engine';
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
    id: 'neon-tower',
    title: 'Neon Tower',
    tagline: 'Тап кладёт блок. Промах режет',
    accent: '#9dff5c',
    accentGlow: 'rgba(157,255,92,0.6)',
    levelLabel: 'Этаж',
    status: 'live',
    mount: createNeonTower,
  },
  {
    id: 'bubble-blast',
    title: 'Bubble Blast',
    tagline: 'Собирай тройки, сноси стену',
    accent: '#28e0ff',
    accentGlow: 'rgba(40,224,255,0.6)',
    levelLabel: 'Волна',
    status: 'live',
    mount: createBubbleBlast,
  },
  {
    id: 'neon-drive',
    title: 'Neon Drive',
    tagline: 'Веди пальцем. Разъезд в притирку — бонус',
    accent: '#ff2e88',
    accentGlow: 'rgba(255,46,136,0.6)',
    levelLabel: 'В притирку',
    status: 'live',
    mount: createNeonDrive,
  },
];

export const getGame = (id: string): GameDefinition | undefined => GAMES.find((g) => g.id === id);

export const LIVE_GAMES = GAMES.filter((g) => g.status === 'live');
