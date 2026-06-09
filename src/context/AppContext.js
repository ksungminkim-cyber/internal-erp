'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { remindMyOverdueApprovals } from '@/app/(app)/approvals/actions';

const AppContext = createContext(null);

export function AppProvider({ children, initialUser, initialProfile = null, initialMemberships = [], initialWorkplaceId = null }) {
  // 매 렌더마다 새 클라이언트 만들지 않도록 lazy init
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(initialUser ?? null);
  const [profile, setProfile] = useState(initialProfile);
  const [memberships, setMemberships] = useState(initialMemberships);
  // 서버 쿠키에서 읽은 initialWorkplaceId 사용 → SSR/클라이언트 동일한 값으로 시작
  // (localStorage 기반 lazy init은 hydration 불일치를 일으켜 이중 렌더/스켈레톤 플래시 유발)
  const [currentWorkplaceId, setCurrentWorkplaceId] = useState(
    initialWorkplaceId ?? (initialMemberships.length > 0 ? initialMemberships[0].workplace_id : null)
  );
  const [loading, setLoading] = useState(false); // layout SSR에서 항상 profile 제공

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

    // super_admin 또는 본사 소속이면 모든 사업장을 switcher에서 접근 가능하게
    let allMems = mems ?? [];
    const isHQ = prof?.is_super_admin || allMems.some((m) => m.workplaces?.name === '본사');
    if (isHQ) {
      const { data: allWps } = await supabase
        .from('workplaces')
        .select('id, name, address')
        .order('name');
      if (allWps?.length) {
        const realWpIds = new Set(allMems.map((m) => m.workplace_id));
        const virtualMems = allWps
          .filter((w) => !realWpIds.has(w.id))
          .map((w) => ({
            id: `virtual_${w.id}`,
            workplace_id: w.id,
            role: 'manager',
            active: true,
            workplaces: w,
          }));
        allMems = [...allMems, ...virtualMems];
      }
    }

    setProfile(prof);
    setMemberships(allMems);
    if (allMems.length) {
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem('erp:workplace')
        : null;
      const validStored = allMems.find((m) => m.workplace_id === stored);
      setCurrentWorkplaceId(validStored?.workplace_id ?? allMems[0].workplace_id);
    }
  }, [supabase]);

  // 접속 시 1회: 장기 미결(지연) 결재 리마인드 — 하루 1회 dedup은 서버에서 처리
  useEffect(() => {
    if (!user?.id) return;
    remindMyOverdueApprovals().catch(() => {});
  }, [user?.id]);

  // localStorage 사업장 선택은 useState lazy init 대신 useEffect로 처리 (hydration 이후 1회)
  useEffect(() => {
    if (typeof window === 'undefined' || initialMemberships.length === 0) return;
    // 쿠키(initialWorkplaceId)가 이미 반영됐으면 localStorage는 무시
    // 쿠키가 없었던 경우에만 localStorage로 보정
    if (initialWorkplaceId) return; // 서버에서 이미 올바른 값 전달됨
    const stored = localStorage.getItem('erp:workplace');
    if (!stored || stored === currentWorkplaceId) return;
    const valid = initialMemberships.find((m) => m.workplace_id === stored);
    if (valid) setCurrentWorkplaceId(valid.workplace_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount 1회만

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
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setMemberships([]);
        setCurrentWorkplaceId(null);
        return;
      }
      // INITIAL_SESSION·TOKEN_REFRESHED: SSR에서 이미 profile/memberships 로드 완료.
      // 이 핸들러 안에서 supabase 쿼리를 호출하면 auth lock과 deadlock → 전 페이지 hang.
      // 재쿼리 불필요 — 스킵.
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      // SIGNED_IN 등 실제 세션 변경 시에만 재로드
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
    if (typeof window !== 'undefined') {
      localStorage.setItem('erp:workplace', wpId);
      // 쿠키에도 저장 → 다음 SSR 시 서버가 올바른 workplaceId 전달
      document.cookie = `erp_wp=${encodeURIComponent(wpId)};path=/;max-age=31536000;SameSite=Lax`;
    }
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
