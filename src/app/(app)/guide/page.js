'use client';

import { useRouter } from 'next/navigation';
import {
  Printer, ChevronLeft, Clock, Coffee, ClipboardList, FileText,
  Package, Calendar, Bell, Users, BookOpen, Wrench, MessageSquareWarning,
  Lightbulb, BarChart3, Lock, Send, Check, X, Home, User, Sparkles,
  ArrowRight, AlertCircle, ShieldCheck, ListChecks,
} from 'lucide-react';

export default function GuidePage() {
  const router = useRouter();

  return (
    <>
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
          html, body { background: #fff !important; }
          .sidebar, .bottom-nav, .page-header, .print-actions { display: none !important; }
          .app-shell { padding: 0 !important; padding-left: 0 !important; }
          .guide-page { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: none !important; }
          .guide-section { page-break-inside: avoid; }
          .guide-cover { page-break-after: always; }
          .guide-chapter { page-break-before: always; }
          .guide-chapter:first-of-type { page-break-before: avoid; }
        }
        .guide-page {
          background: #fff;
          color: #1a1a1a;
          max-width: 210mm;
          margin: 0 auto;
          padding: 28px 32px 60px;
          font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif;
          font-size: 13.5px;
          line-height: 1.6;
          letter-spacing: -0.01em;
        }
        .guide-page h1 { font-size: 28px; font-weight: 900; margin: 0; letter-spacing: -0.02em; color: #1a1a1a; }
        .guide-page h2 { font-size: 20px; font-weight: 800; margin: 0 0 14px; color: #4f46e5; letter-spacing: -0.01em; padding-bottom: 6px; border-bottom: 2px solid #4f46e5; }
        .guide-page h3 { font-size: 15px; font-weight: 800; margin: 18px 0 8px; color: #1a1a1a; display: flex; align-items: center; gap: 6px; }
        .guide-page h4 { font-size: 13px; font-weight: 700; margin: 12px 0 6px; color: #475569; }
        .guide-page p { margin: 0 0 8px; }
        .guide-page ul, .guide-page ol { margin: 4px 0 10px; padding-left: 20px; }
        .guide-page li { margin: 4px 0; }
        .guide-page strong { color: #1a1a1a; font-weight: 700; }
        .guide-cover {
          padding: 60px 40px;
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          color: #fff;
          border-radius: 24px;
          text-align: center;
          margin-bottom: 40px;
        }
        .guide-cover h1 { color: #fff; font-size: 44px; letter-spacing: -0.03em; }
        .guide-cover .subtitle { font-size: 18px; opacity: 0.95; margin-top: 10px; font-weight: 500; }
        .guide-cover .meta { font-size: 12px; opacity: 0.8; margin-top: 36px; }
        .step-box {
          background: #f8fafc;
          border-left: 3px solid #4f46e5;
          padding: 12px 14px;
          border-radius: 8px;
          margin: 8px 0;
        }
        .step-number {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; border-radius: 50%;
          background: #4f46e5; color: #fff;
          font-size: 11px; font-weight: 800;
          margin-right: 8px;
        }
        .tip-box {
          background: #fef3c7;
          border-left: 3px solid #f59e0b;
          padding: 10px 14px;
          border-radius: 8px;
          margin: 10px 0;
          font-size: 12.5px;
        }
        .warn-box {
          background: #fee2e2;
          border-left: 3px solid #dc2626;
          padding: 10px 14px;
          border-radius: 8px;
          margin: 10px 0;
          font-size: 12.5px;
        }
        .admin-box {
          background: #ede9fe;
          border-left: 3px solid #7c3aed;
          padding: 10px 14px;
          border-radius: 8px;
          margin: 10px 0;
          font-size: 12.5px;
        }
        .icon-card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px;
          background: #f8fafc;
          border-radius: 12px;
          margin: 8px 0;
        }
        .icon-card .icon-circle {
          flex-shrink: 0;
          width: 38px; height: 38px;
          border-radius: 12px;
          background: #ede9fe;
          color: #4f46e5;
          display: flex; align-items: center; justify-content: center;
        }
        .toc-item {
          display: flex; justify-content: space-between;
          padding: 6px 10px;
          margin: 2px 0;
          background: #f8fafc;
          border-radius: 6px;
          font-size: 13px;
        }
        .chip-label {
          display: inline-block;
          padding: 2px 8px;
          background: #ede9fe;
          color: #4f46e5;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 700;
          margin-left: 6px;
        }
        .chip-label.admin { background: #fce7f3; color: #be185d; }
        .chip-label.daily { background: #d1fae5; color: #047857; }
        .key-action {
          display: inline-block;
          padding: 2px 8px;
          border: 1px solid #4f46e5;
          color: #4f46e5;
          border-radius: 6px;
          font-weight: 700;
          font-size: 11.5px;
          background: #fff;
        }
      `}</style>

      <div className="print-actions" style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로">
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1, fontWeight: 700 }}>Counter 사용 가이드 — 인쇄 미리보기</div>
        <button onClick={() => window.print()} className="btn btn-primary">
          <Printer size={16} /> PDF 저장 / 인쇄
        </button>
      </div>

      <main className="page-main" style={{ padding: '20px 16px' }}>
        <div className="guide-page">

          {/* ───── 표지 ───── */}
          <div className="guide-cover">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 14, background: 'rgba(255,255,255,0.15)', padding: '6px 14px', borderRadius: 100, fontSize: 12, fontWeight: 600 }}>
              <Sparkles size={14} /> 맥클린 사업장 운영 ERP
            </div>
            <h1>Counter</h1>
            <div className="subtitle">사용 가이드 · 통합본</div>
            <div className="meta">
              나울 · 녹턴 · 본사 공통<br />
              발행 2026. 05. 22 · v1.0
            </div>
          </div>

          {/* ───── 목차 ───── */}
          <section className="guide-section" style={{ marginBottom: 30 }}>
            <h2>목차</h2>
            <div className="toc-item"><span>1장 · 시작하기</span><span style={{ color: '#94a3b8' }}>p.3</span></div>
            <div className="toc-item"><span>2장 · 매일 하는 일 (모든 직원)</span><span style={{ color: '#94a3b8' }}>p.4</span></div>
            <div className="toc-item"><span>3장 · 결재 (지출결의서)</span><span style={{ color: '#94a3b8' }}>p.6</span></div>
            <div className="toc-item"><span>4장 · 운영 — 자주 쓰는 기능</span><span style={{ color: '#94a3b8' }}>p.8</span></div>
            <div className="toc-item"><span>5장 · 건의함</span><span style={{ color: '#94a3b8' }}>p.10</span></div>
            <div className="toc-item"><span>6장 · 관리자 가이드 (매니저 / 대표)</span><span style={{ color: '#94a3b8' }}>p.11</span></div>
            <div className="toc-item"><span>자주 묻는 질문 (FAQ)</span><span style={{ color: '#94a3b8' }}>p.14</span></div>
          </section>

          {/* ───── 1장 시작하기 ───── */}
          <section className="guide-chapter">
            <h2>1장 · 시작하기</h2>

            <h3><Sparkles size={16} color="#4f46e5" /> Counter가 뭐예요?</h3>
            <p>
              Counter는 나울·녹턴 두 카페와 본사가 함께 쓰는 <strong>업무 도구</strong>입니다.
              종이로 하던 출퇴근 기록, 식자재 주문 결재, 인수인계, 매출 정리를 한 곳에서 합니다.
              핸드폰에서도 컴퓨터에서도 똑같이 쓸 수 있어요.
            </p>

            <h3><User size={16} color="#4f46e5" /> 처음 시작하는 법</h3>
            <div className="step-box">
              <p><span className="step-number">1</span><strong>인터넷 주소창에 <span className="key-action">counter.mclean21.com</span> 을 입력합니다.</strong></p>
              <p style={{ marginLeft: 30, color: '#475569', fontSize: 12 }}>핸드폰 즐겨찾기에 등록해두면 편해요.</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">2</span><strong>이메일과 비밀번호로 로그인합니다.</strong></p>
              <p style={{ marginLeft: 30, color: '#475569', fontSize: 12 }}>회원가입은 본사에 요청해주세요. 한번 가입하면 핸드폰·컴퓨터 모두 같은 계정으로 사용합니다.</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">3</span><strong>첫 화면에서 오늘 할 일을 확인합니다.</strong></p>
              <p style={{ marginLeft: 30, color: '#475569', fontSize: 12 }}>새 공지·오늘의 체크리스트·결재 대기 건이 한눈에 보입니다.</p>
            </div>

            <h3><Home size={16} color="#4f46e5" /> 화면 구조 — 5개 탭</h3>
            <div className="icon-card">
              <div className="icon-circle"><Home size={20} /></div>
              <div>
                <strong>홈</strong> — 오늘 할 일 / 공지 / 알림
              </div>
            </div>
            <div className="icon-card">
              <div className="icon-circle"><Clock size={20} /></div>
              <div>
                <strong>근태</strong> — 출근·퇴근·휴게 버튼 (가장 자주 사용)
              </div>
            </div>
            <div className="icon-card">
              <div className="icon-circle"><Package size={20} /></div>
              <div>
                <strong>운영</strong> — 시프트 / 인수인계 / 체크리스트 / 재고 / 레시피 / 장비 등
              </div>
            </div>
            <div className="icon-card">
              <div className="icon-circle"><FileText size={20} /></div>
              <div>
                <strong>결재</strong> — 지출결의서 작성·승인
              </div>
            </div>
            <div className="icon-card">
              <div className="icon-circle"><User size={20} /></div>
              <div>
                <strong>내정보</strong> — 본인 시급·연락처·비밀번호
              </div>
            </div>

            <div className="tip-box">
              <strong><Lightbulb size={13} style={{ verticalAlign: 'middle' }} /> 활용 팁</strong><br />
              화면 위쪽의 <span className="key-action">나울</span> <span className="key-action">녹턴</span> <span className="key-action">본사</span> 칩을 누르면 다른 사업장 화면으로 전환됩니다. 두 매장 모두에서 일하시는 분은 출근하실 매장으로 먼저 전환해주세요.
            </div>
          </section>

          {/* ───── 2장 매일 하는 일 ───── */}
          <section className="guide-chapter">
            <h2>2장 · 매일 하는 일 <span className="chip-label daily">모든 직원</span></h2>

            <h3><Clock size={16} color="#4f46e5" /> 출근 · 퇴근 기록하기</h3>
            <p>매장에 도착하면 가장 먼저 출근 버튼을 눌러주세요. 이 기록이 인건비 계산의 기준이 됩니다.</p>

            <div className="step-box">
              <p><span className="step-number">1</span>하단 탭에서 <span className="key-action">근태</span> 를 누릅니다.</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">2</span>커다란 <span className="key-action">출근</span> 버튼을 누릅니다.</p>
              <p style={{ marginLeft: 30, color: '#475569', fontSize: 12 }}>한 번 누르면 바로 기록됩니다. 다시 누를 필요 없어요.</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">3</span>퇴근할 때 같은 화면에서 <span className="key-action">퇴근</span> 을 누릅니다.</p>
            </div>

            <h3><Coffee size={16} color="#4f46e5" /> 휴게 시간 기록</h3>
            <p>식사·휴식할 때는 <span className="key-action">휴게 시작</span> → 끝나면 <span className="key-action">휴게 종료</span> 를 눌러주세요. 휴게 시간은 근무시간에서 자동으로 빠집니다.</p>

            <div className="warn-box">
              <strong><AlertCircle size={13} style={{ verticalAlign: 'middle' }} /> 주의</strong><br />
              출근을 깜빡 잊고 퇴근하면 그날 근무가 0시간으로 기록됩니다. 출근 직후 바로 누르는 것을 습관으로 만들어주세요.
            </div>

            <h3><ListChecks size={16} color="#4f46e5" /> 오늘 체크리스트</h3>
            <p>홈 화면에 <strong>오늘 해야 할 체크리스트</strong>가 자동으로 떠요. 일별·주별·월별 항목이 모두 모입니다.</p>
            <ul>
              <li>오픈 청소, 마감 청소, 재료 확인 등</li>
              <li>체크박스를 누르면 완료 — 다른 직원에게도 실시간 반영</li>
              <li>새 항목 추가 / 수정도 자유롭게 가능</li>
            </ul>

            <h3><BookOpen size={16} color="#4f46e5" /> 인수인계 메모</h3>
            <p><strong>운영</strong> 탭 → <strong>인수인계</strong> 에서 다음 근무자에게 전할 말을 남깁니다.</p>
            <ul>
              <li>오늘 들어온 클레임 · 주문된 물건 · 손님 특이사항</li>
              <li>한 줄이라도 좋아요. 쓰면 다음 사람이 알 수 있어요.</li>
            </ul>

            <h3><Bell size={16} color="#4f46e5" /> 알림 확인</h3>
            <p>화면 오른쪽 위 <strong>종 아이콘</strong> 에 새 알림이 표시됩니다.</p>
            <ul>
              <li>내가 올린 결재가 승인/반려됐을 때</li>
              <li>새 공지사항이 올라왔을 때</li>
              <li>나에게 결재가 도착했을 때 (관리자만)</li>
            </ul>

            <div className="tip-box">
              <strong><Lightbulb size={13} style={{ verticalAlign: 'middle' }} /> 활용 팁</strong><br />
              아침 출근 후 → 종 아이콘 한 번 확인하는 게 가장 빠른 시작입니다.
            </div>
          </section>

          {/* ───── 3장 결재 ───── */}
          <section className="guide-chapter">
            <h2>3장 · 결재 (지출결의서)</h2>
            <p>식자재 발주, 비품 구매, 수리비 등 <strong>매장에서 돈이 나가는 모든 일</strong>은 지출결의서로 결재를 받습니다. 종이로 적던 결재서가 이제 핸드폰에서 끝납니다.</p>

            <h3><FileText size={16} color="#4f46e5" /> 결재 올리기 — 4단계</h3>
            <div className="step-box">
              <p><span className="step-number">1</span><strong>결재 탭 → 우측 하단 <span className="key-action">+</span> 버튼</strong></p>
            </div>
            <div className="step-box">
              <p><span className="step-number">2</span><strong>제목과 내용을 적어요.</strong></p>
              <p style={{ marginLeft: 30, color: '#475569', fontSize: 12 }}>예) "5월 4주차 식자재 발주" / "에스프레소 머신 수리"</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">3</span><strong>지출 항목을 추가합니다.</strong></p>
              <ul style={{ marginLeft: 24, fontSize: 12.5, color: '#475569' }}>
                <li>품목·카테고리·금액·거래처를 입력</li>
                <li>카테고리는 <strong>매출원가 / 일반관리비 / 공과잡비</strong> 중 자동 분류</li>
                <li>구매처 URL도 적어두면 다음 발주 때 바로가기 가능</li>
                <li>여러 항목 한꺼번에 가능 — <span className="key-action">+ 항목 추가</span></li>
              </ul>
            </div>
            <div className="step-box">
              <p><span className="step-number">4</span><strong>결재자를 지정하고 <span className="key-action">결재 올리기</span></strong></p>
              <p style={{ marginLeft: 30, color: '#475569', fontSize: 12 }}>매니저·대표 중에서 순서대로 결재 받을 사람을 골라요. 영수증 사진도 함께 첨부 가능.</p>
            </div>

            <h3><Check size={16} color="#4f46e5" /> 내가 받은 결재 처리 <span className="chip-label admin">관리자</span></h3>
            <p>나한테 결재가 오면 알림이 옵니다. 결재 탭에서 <strong>결재함</strong> 을 누르면 대기 중인 문서가 보여요.</p>
            <ul>
              <li>내용을 확인하고 <span className="key-action">승인</span> 또는 <span className="key-action">반려</span></li>
              <li>반려할 때는 사유를 적어주세요</li>
              <li>모든 결재자가 승인하면 자동으로 완료 처리</li>
            </ul>

            <h3>결재 상태 보기</h3>
            <ul>
              <li><strong>결재함</strong> — 내가 결재해야 하는 문서</li>
              <li><strong>내 기안</strong> — 내가 올린 문서</li>
              <li><strong>전체</strong> — 우리 매장의 모든 결재 (관리자만)</li>
            </ul>

            <div className="tip-box">
              <strong><Lightbulb size={13} style={{ verticalAlign: 'middle' }} /> 활용 팁</strong><br />
              자주 사는 식자재는 <strong>구매처 URL</strong> 을 꼭 적어두세요. 다음 달에도 똑같이 발주할 때 클릭 한 번이면 됩니다.
            </div>
          </section>

          {/* ───── 4장 운영 ───── */}
          <section className="guide-chapter">
            <h2>4장 · 운영 — 자주 쓰는 기능</h2>

            <h3><Package size={16} color="#4f46e5" /> 재고 · 발주</h3>
            <p>식자재·비품의 현재 재고를 관리하고, 월말에 한 번 마감합니다.</p>
            <div className="step-box">
              <p><strong>일상</strong> — 새 물건이 들어오면 <span className="key-action">+ 항목</span> 으로 등록. 발주가 필요하면 결재 탭에서 지출결의서로 올림</p>
            </div>
            <div className="step-box">
              <p><strong>월말</strong> — <strong>월 재고 마감</strong> 버튼으로 현재 재고를 스냅샷으로 저장</p>
            </div>

            <h3><Calendar size={16} color="#4f46e5" /> 시프트 (근무 일정)</h3>
            <p>월별 캘린더로 나의 근무 일정과 동료들의 근무 일정을 한눈에 봅니다.</p>
            <ul>
              <li>날짜를 누르면 그날 누가 일하는지 보여요</li>
              <li>법정 공휴일도 빨간색으로 표시</li>
              <li>스케줄은 매니저·대표가 작성 (자세한 건 6장)</li>
            </ul>

            <h3><BookOpen size={16} color="#4f46e5" /> 레시피</h3>
            <p>매장마다 다른 메뉴 레시피를 정리합니다. 신입 직원 교육·메뉴 통일에 활용해주세요.</p>
            <ul>
              <li>메뉴별로 재료 / 분량 / 만드는 순서 등록</li>
              <li>사진도 첨부 가능</li>
              <li>레시피는 직원 누구나 자유롭게 수정 가능</li>
            </ul>

            <h3><Wrench size={16} color="#4f46e5" /> 장비 점검</h3>
            <p>에스프레소 머신·냉장고 등 매장 장비의 점검 이력을 기록합니다.</p>
            <ul>
              <li>고장이나 이상 발생 시 즉시 등록 → 매니저에게 알림</li>
              <li>다음 점검 예정일까지 자동으로 알려줘요</li>
            </ul>

            <h3><MessageSquareWarning size={16} color="#4f46e5" /> 고객 클레임</h3>
            <p>손님 불만이나 사고가 있을 때 기록합니다.</p>
            <ul>
              <li>발생 일시 / 손님 정보 / 상황 / 대응 결과</li>
              <li>같은 클레임이 반복되는지 패턴을 본사에서 모니터링</li>
            </ul>

            <div className="tip-box">
              <strong><Lightbulb size={13} style={{ verticalAlign: 'middle' }} /> 활용 팁</strong><br />
              "운영" 탭은 매장에서 자주 쓰는 기능을 한곳에 모은 메뉴함이에요. 처음에는 어디에 뭐가 있는지 몰라도, 매일 한 번씩 둘러보다 보면 금방 익숙해집니다.
            </div>
          </section>

          {/* ───── 5장 건의함 ───── */}
          <section className="guide-chapter">
            <h2>5장 · 건의함</h2>
            <p>매장 운영에 대한 의견·아이디어·개선 요청을 자유롭게 남길 수 있는 공간입니다.</p>
            <ul>
              <li><strong>익명도 가능</strong> — 부담 없이 적어주세요</li>
              <li>본사에서 모두 읽고 검토합니다</li>
              <li>처리 상태 (검토 중 / 반영 / 보류)가 표시돼요</li>
            </ul>

            <div className="tip-box">
              <strong><Lightbulb size={13} style={{ verticalAlign: 'middle' }} /> 활용 팁</strong><br />
              "이건 좀 불편해요", "이런 메뉴 있으면 좋겠어요" 같은 작은 의견도 언제든 환영합니다. 운영진은 직원분들 의견이 가장 소중하다고 생각해요.
            </div>
          </section>

          {/* ───── 6장 관리자 ───── */}
          <section className="guide-chapter">
            <h2>6장 · 관리자 가이드 <span className="chip-label admin">매니저 / 대표 / 본사</span></h2>
            <div className="admin-box">
              <strong><ShieldCheck size={13} style={{ verticalAlign: 'middle' }} /> 이 장은 관리자 권한이 있는 분들만 해당됩니다.</strong> 일반 직원은 메뉴 자체가 보이지 않아요.
            </div>

            <h3><Users size={16} color="#7c3aed" /> 직원 관리 (시급 입력)</h3>
            <p>사이드바 → <strong>직원 관리</strong> → 직원 카드를 누르면 편집 모달이 열립니다.</p>
            <div className="step-box">
              <p><strong>시급 (원/시간)</strong> 항목에 숫자만 입력하고 저장</p>
              <p style={{ marginLeft: 0, color: '#475569', fontSize: 12, marginTop: 4 }}>
                시급이 입력되어야 월 마감에서 인건비가 자동 계산됩니다. 미입력 직원은 0원 처리됩니다.
              </p>
            </div>
            <div className="step-box">
              <p><strong>사업장 배정 / 역할 (매니저 / 대표)</strong></p>
              <p style={{ marginLeft: 0, color: '#475569', fontSize: 12, marginTop: 4 }}>
                같은 직원을 여러 매장에 배정할 수 있어요. 대표 권한은 신중히 부여해주세요.
              </p>
            </div>

            <h3><Calendar size={16} color="#7c3aed" /> 시프트 작성 — 월별 결재</h3>
            <p>매월 말, 다음 달 근무표를 작성하고 결재를 올려요.</p>
            <div className="step-box">
              <p><span className="step-number">1</span><strong>월 선택</strong> 후 캘린더에서 날짜·시간·직원 선택</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">2</span>모든 직원·요일을 채운 다음 <span className="key-action">지난달 복사</span> 로 빠르게 시작 가능</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">3</span><span className="key-action">결재 올리기</span> → 다음 결재자 (대표) 지정 → 제출</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">4</span>승인되면 직원들에게 자동으로 알림 발송 — 별도 공지 불필요</p>
            </div>

            <h3><Send size={16} color="#7c3aed" /> 공지사항 발송</h3>
            <ul>
              <li><strong>공지사항</strong> 메뉴에서 <span className="key-action">+ 새 공지</span></li>
              <li>대상 사업장 선택 (특정 매장 또는 전체)</li>
              <li>중요 공지는 <strong>상단 고정</strong> 체크</li>
              <li>나중에 <strong>수정·삭제 가능</strong></li>
            </ul>

            <h3><BarChart3 size={16} color="#7c3aed" /> KPI 등록</h3>
            <p>매장별 목표 (월 매출, 객단가, 객수 등)를 설정합니다. 결재로 승인된 KPI는 모든 직원에게 알림이 갑니다.</p>

            <h3><Lock size={16} color="#7c3aed" /> 월 마감 — 가장 중요한 월말 작업</h3>
            <p>매출·인건비·지출을 모아서 그 달의 손익을 확정합니다. 종이로 정리하던 손익계산서가 자동으로 만들어져요.</p>

            <h4>월 마감 흐름</h4>
            <div className="step-box">
              <p><span className="step-number">1</span><strong>월 선택</strong> — 기본값은 지난달 (대부분 익월 초에 마감)</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">2</span>실시간 집계 확인 — 매출 / 인건비 (야간·연장·주휴 자동) / 카테고리별 지출</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">3</span><span className="key-action">마감 확정</span> — 그 달의 스냅샷이 저장돼요. 이후 데이터가 바뀌어도 마감 수치는 그대로</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">4</span><span className="key-action">마감 결재 올리기</span> — 대표에게 결재 → 승인되면 자동으로 잠금</p>
            </div>
            <div className="step-box">
              <p><span className="step-number">5</span><span className="key-action">인쇄</span> 로 A4 표준 양식 손익계산서 출력 가능</p>
            </div>

            <div className="tip-box">
              <strong><Lightbulb size={13} style={{ verticalAlign: 'middle' }} /> 활용 팁</strong><br />
              손익계산서는 <strong>매출 → 매출원가 → 매출총이익 → 인건비·일반관리비·공과잡비 → 영업이익</strong> 순으로 표준 양식이 자동 생성됩니다. 세무 자료로도 그대로 활용하실 수 있습니다.
            </div>

            <h3><Check size={16} color="#7c3aed" /> 결재 처리</h3>
            <p>대기 중인 결재가 있으면 알림이 옵니다. 내용 확인 후 승인 / 반려.</p>
          </section>

          {/* ───── FAQ ───── */}
          <section className="guide-chapter">
            <h2>자주 묻는 질문 (FAQ)</h2>

            <h4>Q. 비밀번호를 잊었어요</h4>
            <p>로그인 화면의 "비밀번호 찾기" 또는 본사에 요청해주세요.</p>

            <h4>Q. 출근을 잘못 눌렀어요</h4>
            <p>출근 직후라면 퇴근을 눌러 취소한 뒤 다시 출근해주세요. 시간이 한참 지났으면 매니저에게 요청 → 매니저가 근태 화면에서 보정 가능합니다.</p>

            <h4>Q. 알림이 안 와요</h4>
            <p>브라우저 알림 권한을 허용했는지 확인해주세요. 핸드폰의 경우 홈 화면에 추가(Add to Home Screen) 하면 앱처럼 사용 가능합니다.</p>

            <h4>Q. 결재 받을 사람이 잘못됐어요</h4>
            <p>이미 올라간 결재는 수정이 안 됩니다. 결재자에게 반려를 요청한 뒤 다시 작성해주세요.</p>

            <h4>Q. 시급을 모르겠어요</h4>
            <p>내정보 → 시급 항목에서 본인 시급을 확인할 수 있어요. 표시되지 않으면 매니저에게 입력 요청.</p>

            <h4>Q. 월 마감을 누를 수 있는 사람은?</h4>
            <p>기본적으로 대표 / 본사 직원입니다. 매니저도 가능하게 하려면 직원 관리에서 "마감권한" 을 부여하세요.</p>

            <h4>Q. 두 매장에서 일할 때는?</h4>
            <p>화면 위쪽의 사업장 칩 (나울 / 녹턴) 으로 전환하면 됩니다. 출퇴근도 각 매장에 맞춰 따로 기록돼요.</p>

            <h4>Q. 사진·영수증 첨부는 어떻게?</h4>
            <p>지출결의서 작성 화면 아래 "영수증 첨부" 에서 사진을 올리면 됩니다. 핸드폰에서는 카메라로 바로 촬영해서 첨부 가능.</p>

            <div className="tip-box" style={{ marginTop: 24, background: '#ede9fe', borderLeftColor: '#7c3aed' }}>
              <strong><Sparkles size={13} style={{ verticalAlign: 'middle' }} /> 더 궁금한 점이 있으세요?</strong><br />
              <strong>건의함</strong> 에 적어주시거나 본사 / 매니저에게 문의해주세요. 매뉴얼은 계속 업데이트됩니다.
            </div>
          </section>

          {/* 푸터 */}
          <div style={{ marginTop: 50, paddingTop: 20, borderTop: '1px solid #1a1a1a', fontSize: 11, color: '#475569', textAlign: 'center' }}>
            Counter — 맥클린 사업장 운영 ERP · 본 문서는 내부 교육용입니다 · v1.0 (2026.05)
          </div>
        </div>
      </main>
    </>
  );
}
