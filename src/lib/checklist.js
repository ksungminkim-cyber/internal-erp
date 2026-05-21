// 체크리스트 주기 처리 유틸
export function isChecklistDueToday(template, date = new Date()) {
  if (!template?.active) return false;
  const freq = template.frequency || 'daily';
  if (freq === 'daily') return true;
  if (freq === 'weekly') return Number(template.day_of_week) === date.getDay();
  if (freq === 'monthly') return Number(template.day_of_month) === date.getDate();
  return false; // custom = 수시, 오늘 자동 해당 아님
}

export function frequencyLabel(template) {
  const f = template?.frequency || 'daily';
  if (f === 'daily') return '매일';
  if (f === 'weekly') {
    const dow = ['일', '월', '화', '수', '목', '금', '토'][template.day_of_week ?? 1];
    return `매주 ${dow}요일`;
  }
  if (f === 'monthly') return `매월 ${template.day_of_month ?? 1}일`;
  return '수시';
}
