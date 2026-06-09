'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { isChecklistDueToday, frequencyLabel } from '@/lib/checklist';
import { safeMutate } from '@/lib/safeMutate';
import { todayKey } from '@/lib/date';
import {
  X, Megaphone, ListTodo, Sparkles, ChevronRight, Clock,
  FileText, Calendar, Package, TrendingUp, BookOpen, Lock,
} from 'lucide-react';

const SESSION_KEY = 'counter:welcome:dismissed';

/**
 * 홈 진입 시 보여줄 통합 모달:
 *  1) 첫 로그인이면 온보딩 슬라이드
 *  2) 안 읽은 공지가 있으면 표시
 *  3) 오늘 해야 할 체크리스트 (안 완료된 것)
 *  세 가지 다 없으면 표시 안 함.
 */
export default function WelcomeModal() {
  const { user, profile, currentWorkplaceId, supabase, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [unreadAnns, setUnreadAnns] = useState([]);
  const [todayChecklists, setTodayChecklists] = useState([]);
  const [onboarding, setOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 세션당 한 번만
  useEffect(() => {
    if (!user || !currentWorkplaceId) return;
    if (typeof window === 'undefined') return;
    const dismissedDate = sessionStorage.getItem(SESSION_KEY);
    if (dismissedDate === todayKey()) return; // 오늘 이미 닫음

    (async () => {
      // 1) 안 읽은 공지
      const [{ data: anns }, { data: reads }, { data: tpls }, { data: comps }] = await Promise.all([
        supabase
          .from('announcements')
          .select('id, title, body, pinned, created_at, author_id, author:profiles!announcements_author_id_fkey(name)')
          .eq('workplace_id', currentWorkplaceId)
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5),
        supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id),
        supabase
          .from('checklist_templates')
          .select('*, checklist_items(id)')
          .eq('workplace_id', currentWorkplaceId)
          .eq('active', true),
        supabase
          .from('checklist_completions')
          .select('template_id, items, completed_count, total_count')
          .eq('workplace_id', currentWorkplaceId)
          .eq('completion_date', todayKey()),
      ]);

      const readIds = new Set((reads ?? []).map((r) => r.announcement_id));
      const ann = (anns ?? []).filter((a) => !readIds.has(a.id));

      const compMap = new Map();
      (comps ?? []).forEach((c) => compMap.set(c.template_id, c));
      const due = (tpls ?? [])
        .filter((t) => isChecklistDueToday(t))
        .map((t) => {
          const total = t.checklist_items?.length ?? 0;
          const c = compMap.get(t.id);
          const done = c?.completed_count ?? 0;
          return { ...t, total, done, complete: total > 0 && done >= total };
        })
        .filter((t) => !t.complete);

      const isOnboarding = !profile?.onboarded_at;

      setUnreadAnns(ann);
      setTodayChecklists(due);
      setOnboarding(isOnboarding);
      setOpen(isOnboarding || ann.length > 0 || due.length > 0);
      setStep(isOnboarding ? 0 : ann.length > 0 ? 1 : 2);
      setLoaded(true);
    })();
  }, [user, profile, currentWorkplaceId, supabase]);

  async function close() {
    setOpen(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, todayKey());
    }
    if (onboarding && profile && !profile.onboarded_at) {
      try {
        await safeMutate(supabase
          .from('profiles')
          .update({ onboarded_at: new Date().toISOString() })
          .eq('user_id', profile.user_id));
        refresh?.();
      } catch { /* 온보딩 완료 기록 실패는 조용히 무시 (모달은 이미 닫힘) */ }
    }
  }

  if (!open || !loaded) return null;

  // 표시할 단계 목록
  const steps = [];
  if (onboarding) steps.push('onboarding');
  if (unreadAnns.length > 0) steps.push('announcements');
  if (todayChecklists.length > 0) steps.push('checklists');

  const currentStepIdx = Math.max(0, steps.findIndex((_, i) => i === step) >= 0 ? step : 0);
  const safeStep = Math.min(currentStepIdx, steps.length - 1);
  const currentSection = steps[safeStep];

  const isLast = safeStep === steps.length - 1;

  function next() {
    if (isLast) close();
    else setStep((s) => s + 1);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn .2s var(--ease)',
      }}
    >
      <div
        className="pop-in"
        style={{
          width: '100%', maxWidth: 540,
          maxHeight: '90dvh', overflowY: 'auto',
          background: 'var(--surface)',
          borderRadius: 22,
          padding: 24,
          boxShadow: 'var(--sh-lg)',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase' }}>
            {safeStep + 1} / {steps.length}
          </div>
          <button onClick={close} className="btn btn-ghost btn-icon"><X size={18} /></button>
        </div>

        {currentSection === 'onboarding' && <OnboardingSlide />}
        {currentSection === 'announcements' && <AnnouncementsSlide items={unreadAnns} />}
        {currentSection === 'checklists' && <ChecklistsSlide items={todayChecklists} />}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {safeStep > 0 && (
            <button type="button" className="btn btn-outline" onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ flex: 1 }}>
              이전
            </button>
          )}
          <button type="button" className="btn btn-primary btn-lg" onClick={next} style={{ flex: 2 }}>
            {isLast ? '시작하기' : '다음'} <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingSlide() {
  return (
    <div>
      <div style={{
        width: 56, height: 56, borderRadius: 18,
        background: 'var(--grad-accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 28, fontWeight: 800,
        boxShadow: 'var(--sh-accent)',
        letterSpacing: '-0.04em',
        marginBottom: 14,
      }}>C</div>
      <h2 className="h2">Counter에 오신 것을 환영합니다</h2>
      <p className="text-secondary" style={{ fontSize: 14, marginTop: 8 }}>
        나울·녹턴 운영을 한 곳에서. 핵심만 짧게 안내드릴게요.
      </p>

      <div className="stack stack-3" style={{ marginTop: 16 }}>
        <Tip icon={Clock}      title="근태 — 출퇴근 버튼" desc="매일 출근·휴게·퇴근을 한 번씩 눌러주세요. 인건비 계산 기본이에요." />
        <Tip icon={ListTodo}   title="체크리스트 — 오픈/마감" desc="오픈·마감 시 항목을 체크하면 매장 운영이 일관됩니다." />
        <Tip icon={FileText}   title="지출결의서" desc="자재·비품 등 지출은 결재로. 영수증 사진 첨부 가능." />
        <Tip icon={Calendar}   title="시프트" desc="다음달 시프트는 결재로 올려 사업장 전체가 확인합니다." />
        <Tip icon={Megaphone}  title="공지 / 건의" desc="중요한 공지는 홈에서, 본사로 건의도 직접 보낼 수 있어요." />
      </div>
    </div>
  );
}

function Tip({ icon: Icon, title, desc }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="h4" style={{ fontSize: 14 }}>{title}</div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{desc}</p>
      </div>
    </div>
  );
}

function AnnouncementsSlide({ items }) {
  return (
    <div>
      <div style={{
        width: 56, height: 56, borderRadius: 18,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
      }}>
        <Megaphone size={24} />
      </div>
      <h2 className="h2">안 읽은 공지 {items.length}건</h2>
      <p className="text-secondary" style={{ fontSize: 13, marginTop: 6 }}>오늘 꼭 확인이 필요한 공지예요.</p>

      <div className="stack stack-3" style={{ marginTop: 16 }}>
        {items.map((a) => (
          <Link key={a.id} href="/announcements" style={{ textDecoration: 'none' }}>
            <div className="card compact interactive"
              style={{
                borderLeft: '3px solid var(--accent)',
                background: a.pinned ? 'linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 60%)' : undefined,
              }}
            >
              <div className="h4" style={{ fontSize: 14, color: 'var(--text)' }}>
                {a.pinned && '📌 '}{a.title}
              </div>
              <p className="text-secondary" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {a.body}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ChecklistsSlide({ items }) {
  return (
    <div>
      <div style={{
        width: 56, height: 56, borderRadius: 18,
        background: '#fff1e0', color: '#c2410c',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
      }}>
        <ListTodo size={24} />
      </div>
      <h2 className="h2">오늘 해야 할 체크리스트</h2>
      <p className="text-secondary" style={{ fontSize: 13, marginTop: 6 }}>매장에 오시면 잊지 말고 체크해주세요.</p>

      <div className="stack stack-3" style={{ marginTop: 16 }}>
        {items.map((t) => (
          <Link key={t.id} href="/checklists" style={{ textDecoration: 'none' }}>
            <div className="card compact interactive" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'var(--surface-soft)', color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <ListTodo size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="h4" style={{ fontSize: 14, color: 'var(--text)' }}>{t.name}</div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {frequencyLabel(t)} · {t.done}/{t.total}
                </div>
              </div>
              <ChevronRight size={16} className="text-faint" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
