'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { ChevronLeft, ListTodo, Check, Plus, X, Trash2, Edit3, Sun, Moon, Repeat, Calendar } from 'lucide-react';
import { isChecklistDueToday, frequencyLabel } from '@/lib/checklist';

const TYPE_META = {
  open:    { label: '오픈',  icon: Sun,    tag: 'tag-warning' },
  close:   { label: '마감',  icon: Moon,   tag: 'tag-violet'  },
  weekly:  { label: '주간',  icon: Repeat, tag: 'tag-accent'  },
  custom:  { label: '기타',  icon: ListTodo, tag: 'tag'       },
};

function todayKey() { return new Date().toISOString().slice(0, 10); }

export default function ChecklistsPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase, isManager } = useApp();
  const [templates, setTemplates] = useState([]);
  const [completions, setCompletions] = useState({}); // template_id -> completion row
  const [loading, setLoading] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [editingTemplate, setEditingTemplate] = useState(null);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    const today = todayKey();
    const [{ data: tpl }, { data: comps }] = await Promise.all([
      supabase
        .from('checklist_templates')
        .select('*, checklist_items(id, text, order_idx, required)')
        .eq('workplace_id', currentWorkplaceId)
        .eq('active', true)
        .order('type'),
      supabase
        .from('checklist_completions')
        .select('*')
        .eq('workplace_id', currentWorkplaceId)
        .eq('completion_date', today),
    ]);
    setTemplates((tpl ?? []).map((t) => ({
      ...t,
      checklist_items: (t.checklist_items ?? []).sort((a, b) => a.order_idx - b.order_idx),
    })));
    const cmap = {};
    (comps ?? []).forEach((c) => { cmap[c.template_id] = c; });
    setCompletions(cmap);
    setLoading(false);
  }, [supabase, currentWorkplaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`checklists:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'checklist_completions', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  return (
    <>
      <PageHeader
        title="체크리스트"
        subtitle="오픈·마감 루틴을 매일 체크"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : templates.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><ListTodo size={26} /></div>
            <div className="empty-title">체크리스트가 없어요</div>
            <div className="empty-desc">
              + 버튼으로 새 체크리스트를 만들어보세요
            </div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {templates.map((t) => {
              const comp = completions[t.id];
              const total = t.checklist_items?.length ?? 0;
              const items = comp?.items ?? {};
              const done = Object.values(items).filter((v) => v?.checked).length;
              const pct = total ? Math.round((done / total) * 100) : 0;
              const meta = TYPE_META[t.type] ?? TYPE_META.custom;
              const TypeIcon = meta.icon;

              return (
                <div
                  key={t.id}
                  className="card interactive"
                  onClick={() => setActiveTemplate(t)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <TypeIcon size={22} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="h3">{t.name}</span>
                        <span className={`tag ${meta.tag}`}>{meta.label}</span>
                        <span className="tag" style={{ fontSize: 10 }}>
                          <Calendar size={10} /> {frequencyLabel(t)}
                        </span>
                        {isChecklistDueToday(t) && (
                          <span className="tag tag-accent" style={{ fontSize: 10 }}>오늘</span>
                        )}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {done}/{total} 완료
                      </div>
                    </div>
                    <div className="num" style={{ fontSize: 22, fontWeight: 800, color: pct === 100 ? 'var(--success)' : 'var(--accent)' }}>
                      {pct}%
                    </div>
                  </div>

                  <div style={{ marginTop: 12, height: 8, background: 'var(--surface-soft)', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: pct === 100 ? 'var(--success)' : 'var(--grad-accent)',
                        transition: 'width var(--t-md) var(--ease)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <button type="button" className="fab" onClick={() => setEditingTemplate({})} aria-label="새 체크리스트">
        <Plus size={26} />
      </button>

      {activeTemplate && (
        <ChecklistRunner
          template={activeTemplate}
          completion={completions[activeTemplate.id]}
          supabase={supabase}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          isManager={true}
          onEdit={() => { setEditingTemplate(activeTemplate); setActiveTemplate(null); }}
          onClose={() => setActiveTemplate(null)}
          onChanged={load}
        />
      )}

      {editingTemplate && (
        <ChecklistEditor
          template={editingTemplate}
          supabase={supabase}
          workplaceId={currentWorkplaceId}
          onClose={() => setEditingTemplate(null)}
          onSaved={() => { setEditingTemplate(null); load(); }}
        />
      )}
    </>
  );
}

function ChecklistRunner({ template, completion, supabase, userId, workplaceId, isManager, onEdit, onClose, onChanged }) {
  const total = template.checklist_items?.length ?? 0;
  const initialItems = completion?.items ?? {};
  const [items, setItems] = useState(initialItems);
  const [saving, setSaving] = useState(false);

  const done = Object.values(items).filter((v) => v?.checked).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  async function toggle(itemId) {
    const current = items[itemId]?.checked ?? false;
    const next = !current;
    const newItems = {
      ...items,
      [itemId]: next
        ? { checked: true, by: userId, at: new Date().toISOString() }
        : { checked: false },
    };
    setItems(newItems);
    setSaving(true);
    const completedCount = Object.values(newItems).filter((v) => v?.checked).length;
    await supabase.from('checklist_completions').upsert({
      template_id: template.id,
      workplace_id: workplaceId,
      completion_date: todayKey(),
      items: newItems,
      completed_count: completedCount,
      total_count: total,
      last_updated_by: userId,
      last_updated_at: new Date().toISOString(),
    }, { onConflict: 'template_id,completion_date' });
    setSaving(false);
    onChanged?.();
  }

  return (
    <BottomSheet onClose={onClose} maxWidth={520}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3">{template.name}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {isManager && (
            <button onClick={onEdit} className="btn btn-ghost btn-icon" aria-label="편집"><Edit3 size={16} /></button>
          )}
          <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
        </div>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, height: 8, background: 'var(--surface-soft)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: pct === 100 ? 'var(--success)' : 'var(--grad-accent)',
            transition: 'width var(--t-md) var(--ease)',
          }} />
        </div>
        <span className="num" style={{ fontWeight: 800, fontSize: 16, color: pct === 100 ? 'var(--success)' : 'var(--accent)' }}>
          {done}/{total}
        </span>
      </div>

      <div className="stack stack-2">
        {template.checklist_items?.map((it) => {
          const checked = items[it.id]?.checked;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => toggle(it.id)}
              disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: 14, borderRadius: 14,
                background: checked ? 'var(--success-soft)' : 'var(--surface-soft)',
                border: 'none', textAlign: 'left', cursor: 'pointer',
                width: '100%',
                transition: 'all var(--t-sm) var(--ease)',
              }}
            >
              <div
                style={{
                  width: 24, height: 24, borderRadius: 8,
                  background: checked ? 'var(--success)' : '#fff',
                  border: checked ? 'none' : '1.5px solid var(--border-strong)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff',
                  transition: 'all var(--t-sm) var(--ease-bounce)',
                  flexShrink: 0,
                }}
              >
                {checked && <Check size={14} strokeWidth={3} />}
              </div>
              <span style={{
                flex: 1,
                fontSize: 14, fontWeight: 600,
                color: checked ? 'var(--text-muted)' : 'var(--text)',
                textDecoration: checked ? 'line-through' : 'none',
              }}>
                {it.text}
              </span>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}

const DOW_OPTIONS = [
  { v: 1, label: '월' }, { v: 2, label: '화' }, { v: 3, label: '수' },
  { v: 4, label: '목' }, { v: 5, label: '금' }, { v: 6, label: '토' }, { v: 0, label: '일' },
];

function ChecklistEditor({ template, supabase, workplaceId, onClose, onSaved }) {
  const isEdit = !!template?.id;
  const [name, setName] = useState(template?.name ?? '');
  const [type, setType] = useState(template?.type ?? 'open');
  const [frequency, setFrequency] = useState(template?.frequency ?? 'daily');
  const [dayOfWeek, setDayOfWeek] = useState(template?.day_of_week ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(template?.day_of_month ?? 1);
  const [items, setItems] = useState(
    (template?.checklist_items ?? []).map((i) => ({ id: i.id, text: i.text, order_idx: i.order_idx, required: i.required }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function addItem() {
    setItems((prev) => [...prev, { text: '', order_idx: prev.length, required: true }]);
  }
  function updateItem(idx, text) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, text } : it)));
  }
  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError('이름을 입력해주세요.');
    const validItems = items.filter((it) => it.text.trim());
    if (validItems.length === 0) return setError('최소 1개 항목이 필요해요.');

    setSaving(true);
    try {
      const meta = {
        name: name.trim(),
        type,
        frequency,
        day_of_week: frequency === 'weekly' ? Number(dayOfWeek) : null,
        day_of_month: frequency === 'monthly' ? Number(dayOfMonth) : null,
      };
      let templateId = template?.id;
      if (isEdit) {
        const { error } = await supabase
          .from('checklist_templates')
          .update(meta)
          .eq('id', templateId);
        if (error) throw error;
        await supabase.from('checklist_items').delete().eq('template_id', templateId);
      } else {
        const { data, error } = await supabase
          .from('checklist_templates')
          .insert({ workplace_id: workplaceId, ...meta })
          .select('id')
          .single();
        if (error) throw error;
        templateId = data.id;
      }
      const { error: e2 } = await supabase.from('checklist_items').insert(
        validItems.map((it, idx) => ({
          template_id: templateId,
          text: it.text.trim(),
          order_idx: idx,
          required: it.required ?? true,
        }))
      );
      if (e2) throw e2;
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!confirm('이 체크리스트를 삭제하시겠습니까?')) return;
    setSaving(true);
    const { error } = await supabase
      .from('checklist_templates')
      .update({ active: false })
      .eq('id', template.id);
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '체크리스트 편집' : '새 체크리스트'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">이름</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 오픈 체크리스트" />

      <label className="label" style={{ marginTop: 12 }}>유형</label>
      <div className="segment" style={{ width: '100%' }}>
        {Object.entries(TYPE_META).map(([k, m]) => (
          <button
            key={k}
            type="button"
            className={`segment-item ${type === k ? 'is-active' : ''}`}
            onClick={() => setType(k)}
            style={{ flex: 1 }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>주기</label>
      <div className="segment" style={{ width: '100%' }}>
        {[
          { v: 'daily', l: '매일' },
          { v: 'weekly', l: '매주' },
          { v: 'monthly', l: '매월' },
          { v: 'custom', l: '수시' },
        ].map((f) => (
          <button
            key={f.v}
            type="button"
            className={`segment-item ${frequency === f.v ? 'is-active' : ''}`}
            onClick={() => setFrequency(f.v)}
            style={{ flex: 1 }}
          >
            {f.l}
          </button>
        ))}
      </div>
      {frequency === 'weekly' && (
        <div style={{ marginTop: 8 }}>
          <label className="label">요일</label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DOW_OPTIONS.map((d) => (
              <button
                key={d.v}
                type="button"
                onClick={() => setDayOfWeek(d.v)}
                className={`tag ${Number(dayOfWeek) === d.v ? 'tag-accent' : ''}`}
                style={{ cursor: 'pointer', minWidth: 36, justifyContent: 'center' }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {frequency === 'monthly' && (
        <div style={{ marginTop: 8 }}>
          <label className="label">매월 며칠</label>
          <input
            className="input num"
            type="number"
            min={1} max={31}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            placeholder="1~31"
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
        <label className="label" style={{ margin: 0 }}>항목</label>
        <button type="button" className="btn btn-soft btn-xs" onClick={addItem}>
          <Plus size={12} /> 항목
        </button>
      </div>

      <div className="stack stack-2">
        {items.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>아직 항목이 없어요</p>
        ) : (
          items.map((it, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8 }}>
              <span className="num text-muted" style={{ width: 28, textAlign: 'center', alignSelf: 'center', fontWeight: 700 }}>
                {idx + 1}
              </span>
              <input
                className="input"
                value={it.text}
                onChange={(e) => updateItem(idx, e.target.value)}
                placeholder="할 일"
                style={{ flex: 1 }}
              />
              <button type="button" onClick={() => removeItem(idx)} className="btn btn-ghost btn-icon">
                <Trash2 size={14} color="var(--danger)" />
              </button>
            </div>
          ))
        )}
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {isEdit && (
          <button type="button" className="btn btn-outline" onClick={deleteTemplate} disabled={saving} style={{ color: 'var(--danger)' }}>
            <Trash2 size={14} />
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}
