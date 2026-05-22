'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

const AppContext = createContext(null);

export function AppProvider({ children, initialUser }) {
  // 매 렌더마다 새 클라이언트 만들지 않도록 lazy init
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(initialUser ?? null);
  const [profile, setProfile] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [currentWorkplaceId, setCurrentWorkplaceId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfileAndMemberships = useCallback(async (uid) => {
    if (!uid) return;
    const [{ data: prof }, { data: mems }] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle(),
      supabase
        .from('memberships')
        .select('id, workplace_id, role, active, workplaces(id, name, address)')
        .eq('user_id', uid)
        .eq('active', true),
    ]);
    setProfile(prof);
    setMemberships(mems ?? []);
    if (mems?.length) {
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem('erp:workplace')
        : null;
      const validStored = mems.find((m) => m.workplace_id === stored);
      setCurrentWorkplaceId(validStored?.workplace_id ?? mems[0].workplace_id);
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser(u);
      if (u) await loadProfileAndMemberships(u.id);
      setLoading(false);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) await loadProfileAndMemberships(u.id);
      else {
        setProfile(null);
        setMemberships([]);
        setCurrentWorkplaceId(null);
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [supabase, loadProfileAndMemberships]);

  const switchWorkplace = useCallback((wpId) => {
    setCurrentWorkplaceId(wpId);
    if (typeof window !== 'undefined') localStorage.setItem('erp:workplace', wpId);
  }, []);

  const currentMembership = memberships.find((m) => m.workplace_id === currentWorkplaceId) ?? null;
  const currentWorkplace = currentMembership?.workplaces ?? null;
  // role 없으면 null — UI에서 fallback 처리 (super_admin이면 owner로 간주)
  const role = currentMembership?.role
    ?? (profile?.is_super_admin ? 'owner' : null);
  const isManager = role === 'manager' || role === 'owner';

  const value = {
    user, profile, memberships, currentWorkplaceId, currentWorkplace,
    currentMembership, role, isManager, loading,
    switchWorkplace, refresh: () => user && loadProfileAndMemberships(user.id),
    supabase,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
