'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency, formatRelative } from '@/lib/format';
import { ChevronLeft, Edit3, BookOpen, Plus, Trash2 } from 'lucide-react';

const CATEGORY_OPTIONS = ['에스프레소', '브루잉', '라떼/베리에이션', '논커피', '디저트', '베이커리', '기타'];

export default function RecipeDetail({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, supabase, isManager, profile, currentWorkplaceId, memberships } = useApp();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [editing, setEditing] = useState(isNew);

  // form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('에스프레소');
  const [servingSize, setServingSize] = useState('');
  const [cost, setCost] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [ingredients, setIngredients] = useState([{ name: '', qty: '', unit: '', note: '' }]);
  const [steps, setSteps] = useState(['']);
  const [workplaceId, setWorkplaceId] = useState(currentWorkplaceId ?? '');
  const [workplaceName, setWorkplaceName] = useState('');
  const [updatedBy, setUpdatedBy] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const { data: r } = await supabase
      .from('recipes')
      .select('*, updater:profiles!recipes_updated_by_fkey(name), workplaces(name)')
      .eq('id', id)
      .maybeSingle();
    if (r) {
      setName(r.name);
      setCategory(r.category || '에스프레소');
      setServingSize(r.serving_size || '');
      setCost(r.cost ?? '');
      setSellPrice(r.sell_price ?? '');
      setNotes(r.notes || '');
      setIngredients(r.ingredients?.length ? r.ingredients : [{ name: '', qty: '', unit: '', note: '' }]);
      setSteps(r.steps?.length ? r.steps : ['']);
      setWorkplaceId(r.workplace_id ?? '');
      setWorkplaceName(r.workplaces?.name ?? '');
      setUpdatedBy(r.updater?.name);
      setUpdatedAt(r.updated_at);
    }
    setLoading(false);
  }, [supabase, id, isNew]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setError(null);
    if (!name.trim()) return setError('이름을 입력해주세요.');
    const validIngredients = ingredients.filter((i) => i.name?.trim());
    const validSteps = steps.filter((s) => s?.trim());
    if (validIngredients.length === 0) return setError('재료를 최소 1개 입력해주세요.');

    setSaving(true);
    const payload = {
      workplace_id: workplaceId || null,
      name: name.trim(),
      category,
      serving_size: servingSize.trim() || null,
      cost: Number(cost) || null,
      sell_price: Number(sellPrice) || null,
      notes: notes.trim() || null,
      ingredients: validIngredients,
      steps: validSteps,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const op = isNew
      ? supabase.from('recipes').insert({ ...payload, created_by: user.id }).select('id').single()
      : supabase.from('recipes').update(payload).eq('id', id);
    const res = await op;
    if (res.error) { setError(res.error.message); setSaving(false); return; }
    if (isNew && res.data?.id) {
      router.replace(`/recipes/${res.data.id}`);
    } else {
      setEditing(false);
      load();
    }
    setSaving(false);
  }

  async function archive() {
    if (!confirm('이 레시피를 보관 처리할까요?')) return;
    setSaving(true);
    const { error } = await supabase.from('recipes').update({ active: false }).eq('id', id);
    if (error) { setError(error.message); setSaving(false); return; }
    router.replace('/recipes');
  }

  if (loading) {
    return (
      <main className="section"><div className="skeleton" style={{ height: 200 }} /></main>
    );
  }

  if (!editing) {
    return (
      <>
        <PageHeader
          title={name || '—'}
          subtitle={`${category} · ${workplaceName || '공통'}`}
          hideSwitcher
          action={
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
          }
        />

        <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 가격·서빙 카드 */}
          <section className="bento accent" style={{ minHeight: 130 }}>
            <div className="bento-decor" />
            <div className="bento-label">판매가</div>
            <div className="bento-value num">
              {sellPrice ? formatCurrency(sellPrice) : '-'}<span style={{ fontSize: 16, opacity: 0.85, marginLeft: 4 }}>원</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, opacity: 0.92 }}>
              {servingSize && <span>📏 {servingSize}</span>}
              {cost && <span>💰 원가 {formatCurrency(cost)}원</span>}
              {sellPrice && cost && (
                <span>📈 마진 {Math.round(((Number(sellPrice) - Number(cost)) / Number(sellPrice)) * 100)}%</span>
              )}
            </div>
          </section>

          {/* 재료 */}
          <section className="card">
            <h2 className="h3" style={{ marginBottom: 12 }}>재료</h2>
            <div className="stack stack-2">
              {ingredients.filter((i) => i.name).map((it, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--surface-soft)', borderRadius: 10 }}>
                  <span className="num text-muted" style={{ width: 24, textAlign: 'center', fontWeight: 700 }}>{idx + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{it.name}</span>
                  <span className="num text-secondary" style={{ fontSize: 13 }}>
                    {it.qty}<span style={{ marginLeft: 2, color: 'var(--text-muted)' }}>{it.unit}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 공정 */}
          <section className="card">
            <h2 className="h3" style={{ marginBottom: 12 }}>제조 공정</h2>
            <div className="stack stack-2">
              {steps.filter((s) => s).map((s, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 12 }}>
                  <span
                    className="num"
                    style={{
                      width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                      background: 'var(--accent)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <p style={{ flex: 1, fontSize: 14, lineHeight: 1.6, paddingTop: 4 }}>{s}</p>
                </div>
              ))}
            </div>
          </section>

          {notes && (
            <section className="card" style={{ background: 'var(--warning-soft)', boxShadow: 'none' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 6 }}>
                💡 팁
              </div>
              <p style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{notes}</p>
            </section>
          )}

          {updatedBy && (
            <p className="text-muted" style={{ fontSize: 11, textAlign: 'center' }}>
              {updatedBy}님이 {formatRelative(updatedAt)} 업데이트
            </p>
          )}

          <button type="button" className="btn btn-outline btn-lg" onClick={() => setEditing(true)}>
            <Edit3 size={14} /> 편집
          </button>
        </main>
      </>
    );
  }

  // 편집 모드
  return (
    <>
      <PageHeader
        title={isNew ? '새 레시피' : '레시피 편집'}
        hideSwitcher
        action={
          <button onClick={() => isNew ? router.back() : setEditing(false)} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card">
          <label className="label">이름</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 카페라떼" />

          <label className="label" style={{ marginTop: 12 }}>적용 매장</label>
          <select className="input" value={workplaceId} onChange={(e) => setWorkplaceId(e.target.value)}>
            <option value="">공통 (나울 + 녹턴 모두 표시)</option>
            {memberships.filter((m) => m.workplaces?.name !== '본사').map((m) => (
              <option key={m.workplace_id} value={m.workplace_id}>{m.workplaces?.name}</option>
            ))}
          </select>
          <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
            한 매장 전용으로 만들거나, 양쪽 매장 모두에서 보이도록 &ldquo;공통&rdquo; 선택
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <div>
              <label className="label">카테고리</label>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">서빙</label>
              <input className="input" value={servingSize} onChange={(e) => setServingSize(e.target.value)} placeholder="예) 350ml" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <div>
              <label className="label">원가 (원)</label>
              <input className="input num" type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div>
              <label className="label">판매가 (원)</label>
              <input className="input num" type="number" inputMode="numeric" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 className="h3">재료</h2>
            <button type="button" className="btn btn-soft btn-xs" onClick={() => setIngredients((p) => [...p, { name: '', qty: '', unit: '', note: '' }])}>
              <Plus size={12} /> 재료
            </button>
          </div>
          <div className="stack stack-2">
            {ingredients.map((it, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  placeholder="재료명"
                  value={it.name}
                  onChange={(e) => setIngredients((prev) => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                  style={{ flex: 2 }}
                />
                <input
                  className="input"
                  placeholder="양"
                  value={it.qty}
                  onChange={(e) => setIngredients((prev) => prev.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
                  style={{ flex: 1 }}
                />
                <input
                  className="input"
                  placeholder="단위"
                  value={it.unit}
                  onChange={(e) => setIngredients((prev) => prev.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                  style={{ flex: 1 }}
                />
                <button type="button" onClick={() => setIngredients((p) => p.filter((_, i) => i !== idx))} className="btn btn-ghost btn-icon">
                  <Trash2 size={14} color="var(--danger)" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 className="h3">제조 공정</h2>
            <button type="button" className="btn btn-soft btn-xs" onClick={() => setSteps((p) => [...p, ''])}>
              <Plus size={12} /> 단계
            </button>
          </div>
          <div className="stack stack-2">
            {steps.map((s, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8 }}>
                <span className="num text-muted" style={{ width: 28, textAlign: 'center', alignSelf: 'center', fontWeight: 700 }}>
                  {idx + 1}
                </span>
                <textarea
                  className="input"
                  rows={2}
                  value={s}
                  onChange={(e) => setSteps((prev) => prev.map((x, i) => i === idx ? e.target.value : x))}
                  placeholder="이 단계의 작업 내용"
                  style={{ flex: 1, resize: 'vertical' }}
                />
                <button type="button" onClick={() => setSteps((p) => p.filter((_, i) => i !== idx))} className="btn btn-ghost btn-icon">
                  <Trash2 size={14} color="var(--danger)" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <label className="label">팁 / 주의사항 (선택)</label>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="예) 우유 온도 65도 유지, 얼음 변형 시 주의" style={{ resize: 'vertical' }} />
        </section>

        {error && (
          <div style={{ padding: 12, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          {!isNew && (
            <button type="button" className="btn btn-outline" onClick={archive} disabled={saving} style={{ color: 'var(--danger)' }}>
              <Trash2 size={14} />
            </button>
          )}
          <button type="button" className="btn btn-outline btn-lg" onClick={() => isNew ? router.back() : setEditing(false)} style={{ flex: 1 }}>
            취소
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={save} disabled={saving} style={{ flex: 2 }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </main>
    </>
  );
}
