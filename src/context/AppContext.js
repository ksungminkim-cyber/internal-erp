'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

const AppContext = createContext(null);

export function AppProvider({ children, initialUser, initialProfile = null, initialMemberships = [] }) {
  // 매 렌더마다 새 클라이언트 만들지 않도록 lazy init
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(initialUser ?? null);
  const [profile, setProfile] = useState(initialProfile);
  const [memberships, setMemberships] = useState(initialMemberships);
  // SSR + localStorage 모두 고려한 lazy init
  const [currentWorkplaceId, setCurrentWorkplaceId] = useState(() => {
    if (initialMemberships.length === 0) return null;
    // 클라이언트에서만 localStorage 접근 가능
    const stored = typeof window !== 'undefined' ? localStorage.getItem('erp:workplace') : null;
    const validStored = stored ? initialMemberships.find((m) => m.workplace_id === stored) : null;
    return validStored?.workplace_id ?? initialMemberships[0].workplace_id;
  });
  const [loading, setLoading] = useState(!initialProfile); // 초기 profile 있으면 loading false

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

  // localStorage 사업장 선택은 useState lazy init에서 처리 (위 참조)

  useEffect(() => {
    let mounted = true;
    // initialProfile 가 없으면 (SSR 실패 등) 클라이언트에서라도 시도
    if (!initialProfile && initialUser) {
      (async () => {
        if (!mounted) return;
        await loadProfileAndMemberships(initialUser.id);
        setLoading(false);
      })();
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // SIGNED_OUT 일 때만 상태 초기화
      // INITIAL_SESSION·TOKEN_REFRESHED 등 중간 상태에서 session=null 이 와도 무시
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setMemberships([]);
        setCurrentWorkplaceId(null);
        return;
      }
      const u = session?.user ?? null;
      if (u) {
        setUser(u);
        await loadProfileAndMemberships(u.id);
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [supabase, loadProfileAndMemberships, initialProfile, initialUser]);

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
