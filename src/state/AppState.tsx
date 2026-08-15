import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Profile } from '../api/types';

interface AppState {
  profile: Profile | null;
  isPro: boolean;
  isAdmin: boolean;
  loading: boolean;
  refresh(): Promise<void>;
  setProfile(p: Profile): void;
  /** Пейволл — глобальный: открывается из любого экрана. */
  paywallReason: string | null;
  openPaywall(reason: string): void;
  closePaywall(): void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paywallReason, setPaywallReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setProfile(await api.getProfile());
  }, []);

  useEffect(() => {
    // touchSession заодно регистрирует вход — на нём строится «последний визит».
    void (async () => {
      const [p, admin] = await Promise.all([api.touchSession(), api.isAdmin()]);
      setProfile(p);
      setIsAdmin(admin);
      setLoading(false);
    })();
  }, []);

  const value = useMemo<AppState>(
    () => ({
      profile,
      isPro: profile?.tier === 'pro',
      isAdmin,
      loading,
      refresh,
      setProfile,
      paywallReason,
      openPaywall: setPaywallReason,
      closePaywall: () => setPaywallReason(null),
    }),
    [profile, isAdmin, loading, refresh, paywallReason],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState вне AppStateProvider');
  return ctx;
}
