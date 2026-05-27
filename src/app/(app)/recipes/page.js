'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { ChevronLeft, Plus, Search, BookOpen, Coffee, Cake, IceCream, Building2 } from 'lucide-react';

const CATEGORY_ICON = {
  '에스프레소': Coffee,
  '브루잉': Coffee,
  '라떼/베리에이션': Coffee,
  '논커피': IceCream,
  '디저트': Cake,
  '베이커리': Cake,
};

export default function RecipesPage() {
  const router = useRouter();
  const { supabase, isManager, currentWorkplaceId, currentWorkplace, memberships } = useApp();
  const [items, setItems] = useState([]);
  const [workplaces, setWorkplaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  // scope: 매장 id (본사 제외)
  const [scope, setScope] = useState(currentWorkplaceId);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rec }, { data: wps }] = await Promise.all([
      supabase
        .from('recipes')
        .select('*, workplaces(name)')
        .eq('active', true)
        .order('workplace_id', { ascending: true, nullsFirst: true })
        .order('category')
        .order('name'),
      supabase.from('workplaces').select('id, name').order('name'),
    ]);
    setItems(rec ?? []);
    setWorkplaces(wps ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('recipes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, load]);

  // 본사 제외 — 레시피는 매장(나울/녹턴)에만 존재
  const storeWorkplaces = useMemo(
    () => workplaces.filter((w) => w.name !== '본사'),
    [workplaces]
  );

  // scope가 본사이거나 없으면 첫 매장으로 자동 보정
  useEffect(() => {
    if (storeWorkplaces.length === 0) return;
    const valid = storeWorkplaces.some((w) => w.id === scope);
    if (!valid) setScope(storeWorkplaces[0].id);
  }, [storeWorkplaces, scope]);

  const categories = useMemo(() => {
    const set = new Set();
    items
      .filter((r) => r.workplace_id === scope || r.workplace_id === null)
      .forEach((r) => { if (r.category) set.add(r.category); });
    return Array.from(set);
  }, [items, scope]);

  const filtered = useMemo(() => {
    // 선택한 매장 소속 레시피 + 양쪽 매장에 공통(workplace_id=null)
    let list = items.filter((r) => r.workplace_id === scope || r.workplace_id === null);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (category !== 'all') list = list.filter((r) => r.category === category);
    return list;
  }, [items, search, category, scope]);

  const scopeWp = storeWorkplaces.find((w) => w.id === scope);

  return (
    <>
      <PageHeader
        title="레시피"
        subtitle={scopeWp?.name ? `${scopeWp.name} 레시피` : '매장별 레시피'}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="레시피 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
        </div>

        {/* 매장 필터 — 나울 / 녹턴 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {storeWorkplaces.map((w) => (
            <button
              key={w.id}
              className={`tag ${scope === w.id ? 'tag-accent' : ''}`}
              onClick={() => setScope(w.id)}
            >
              <Building2 size={11} /> {w.name}
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button className={`tag ${category === 'all' ? 'tag-accent' : ''}`} onClick={() => setCategory('all')}>
              카테고리 전체
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={`tag ${category === c ? 'tag-accent' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><BookOpen size={26} /></div>
            <div className="empty-title">{search ? '검색 결과 없음' : '레시피 없음'}</div>
            <div className="empty-desc">
              + 버튼으로 첫 레시피를 작성해보세요
            </div>
          </div>
        ) : (
          <div className="grid-4">
            {filtered.map((r) => {
              const Icon = CATEGORY_ICON[r.category] || BookOpen;
              return (
                <Link key={r.id} href={`/recipes/${r.id}`} style={{ textDecoration: 'none' }}>
                  <div className="card compact interactive" style={{ minHeight: 130 }}>
                    <div
                      style={{
                        width: 38, height: 38, borderRadius: 12,
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      {r.category && (
                        <span className="text-muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase' }}>
                          {r.category}
                        </span>
                      )}
                    </div>
                    <div className="h4">{r.name}</div>

                    {r.sell_price != null && (
                      <div className="num" style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                        {formatCurrency(r.sell_price)}원
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <Link href="/recipes/new" className="fab" style={{ textDecoration: 'none' }} aria-label="새 레시피">
        <Plus size={26} />
      </Link>
    </>
  );
}
