import { useEffect, useState } from 'react';
import { BetaOffer } from './components/BetaOffer';
import { Paywall } from './components/Paywall';
import { TabBar, type Tab } from './components/TabBar';
import { AdminScreen } from './screens/AdminScreen';
import { GameScreen } from './screens/GameScreen';
import { GamesScreen } from './screens/GamesScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { AppStateProvider, useAppState } from './state/AppState';
import { useBackButtonHandle } from './telegram/webapp';

/** Экраны поверх табов: игра и админка. */
type Overlay = { kind: 'game'; gameId: string } | { kind: 'admin' } | null;

function Shell() {
  const { loading, fatal, refresh } = useAppState();
  const [tab, setTab] = useState<Tab>('games');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const backButton = useBackButtonHandle();

  // Модальные экраны получают нативную кнопку «назад» в шапке Telegram.
  useEffect(() => {
    if (!overlay) return;
    return backButton.show(() => setOverlay(null));
  }, [overlay, backButton]);

  if (loading)
    return (
      <div className="boot">
        RETRO
        <br />
        GAME CLUB
      </div>
    );

  if (fatal)
    return (
      <div className="fatal">
        <div className="fatal__emoji">🔌</div>
        <h1 className="fatal__title">Не удалось подключиться</h1>
        <p className="fatal__text">{fatal}</p>
        <button className="btn btn--secondary" onClick={() => location.reload()}>
          Попробовать снова
        </button>
      </div>
    );

  if (overlay?.kind === 'game') {
    return (
      <>
        <GameScreen
          gameId={overlay.gameId}
          onExit={() => {
            setOverlay(null);
            void refresh();
          }}
        />
        <Paywall />
      </>
    );
  }

  if (overlay?.kind === 'admin') {
    return <AdminScreen onExit={() => setOverlay(null)} />;
  }

  return (
    <div className="app">
      <main className="app__content">
        {tab === 'games' && <GamesScreen onOpenGame={(gameId) => setOverlay({ kind: 'game', gameId })} />}
        {tab === 'leaderboard' && <LeaderboardScreen />}
        {tab === 'profile' && <ProfileScreen onOpenAdmin={() => setOverlay({ kind: 'admin' })} />}
      </main>
      <TabBar active={tab} onChange={setTab} />
      <Paywall />
      <BetaOffer />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
