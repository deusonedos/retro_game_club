export type Tab = 'games' | 'leaderboard' | 'profile';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'leaderboard', label: 'Рейтинг', icon: '🏆' },
  { id: 'games', label: 'Игры', icon: '🎮' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
];

interface Props {
  active: Tab;
  onChange(tab: Tab): void;
}

export function TabBar({ active, onChange }: Props) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tabbar__item${active === t.id ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="tabbar__icon">{t.icon}</span>
          <span className="tabbar__label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
