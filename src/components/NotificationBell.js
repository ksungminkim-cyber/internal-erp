'use client';

import { useEffect, useState, useCallback, useRef, useId } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { formatRelative } from '@/lib/format';
import { Bell, Check, CheckCheck } from 'lucide-react';

const TYPE_LABEL = {
  approval_decided: '결재 결과',
  approval_assigned: '결재 요청',
  suggestion_response: '건의 응답',
  announcement_new: '새 공지',
};

export default function NotificationBell({ inline = false }) {
  const { user, supabase } = useApp();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const instanceId = useId();

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setItems(data ?? []);
  }, [supabase, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    // useId 로 인스턴스마다 채널 이름 unique 화 (mobile/desktop 동시 렌더링 시 충돌 방지)
    const channelName = `notifications:${user.id}${instanceId}`;
    const ch = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, user, load, instanceId]);

  useEffect(() => {
    function onDocClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    }
    if (open) {
      window.addEventListener('click', onDocClick);
      return () => window.removeEventListener('click', onDocClick);
    }
  }, [open]);

  const unread = items.filter((n) => !n.read_at);
  const unreadCount = unread.length;

  async function markRead(id) {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  }

  async function markAllRead() {
    const ids = unread.map((n) => n.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.map((n) => ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label="알림"
        style={{
          position: 'relative',
          width: 36, height: 36, borderRadius: 10,
          background: open ? 'var(--accent-soft)' : 'transparent',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: open ? 'var(--accent)' : 'var(--text-secondary)',
          transition: 'all var(--t-sm) var(--ease)',
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="num"
            style={{
              position: 'absolute', top: 4, right: 4,
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 999,
              background: 'var(--danger)', color: '#fff',
              fontSize: 9, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="pop-in"
          style={{
            position: 'absolute',
            top: '100%',
            right: inline ? 0 : 'auto',
            left: inline ? 'auto' : 0,
            marginTop: 6,
            width: 360, maxWidth: '90vw', maxHeight: 480,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: 'var(--sh-lg)',
            zIndex: 60,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 14px', borderBottom: '1px solid var(--border)',
            position: 'sticky', top: 0, background: 'var(--surface)',
          }}>
            <strong style={{ fontSize: 14 }}>알림</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={markAllRead}
                style={{ minHeight: 24, padding: '4px 8px' }}
              >
                <CheckCheck size={11} /> 모두 읽음
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <Bell size={26} color="var(--text-muted)" style={{ marginBottom: 8 }} />
              <p className="text-muted" style={{ fontSize: 13 }}>알림이 없어요</p>
            </div>
          ) : (
            <div>
              {items.map((n) => (
                <Link
                  key={n.id}
                  href={n.link ?? '#'}
                  onClick={() => { markRead(n.id); setOpen(false); }}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  <div
                    style={{
                      display: 'flex', gap: 10,
                      padding: '12px 14px',
                      borderBottom: '1px solid var(--border)',
                      background: n.read_at ? 'transparent' : 'var(--accent-soft)',
                      transition: 'background var(--t-fast) var(--ease)',
                    }}
                  >
                    {!n.read_at && (
                      <div style={{
                        width: 6, height: 6, borderRadius: 999,
                        background: 'var(--accent)', marginTop: 8, flexShrink: 0,
                      }} />
                    )}
                    {n.read_at && <div style={{ width: 6, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span className="h4" style={{ fontSize: 13, color: 'var(--text)' }}>{n.title}</span>
                      </div>
                      {n.body && (
                        <p className="text-secondary" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {n.body}
                        </p>
                      )}
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {TYPE_LABEL[n.type] || n.type} · {formatRelative(n.created_at)}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
