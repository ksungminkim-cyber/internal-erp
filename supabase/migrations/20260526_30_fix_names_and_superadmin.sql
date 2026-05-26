-- ============================================================
-- 데이터 복구: name=null 프로필 복원 + 본사 멤버 is_super_admin 부여
-- ============================================================

-- 1. 이름이 없는 프로필 → auth 메타데이터 또는 이메일 prefix로 복원
UPDATE profiles
SET
  name       = COALESCE(
                 NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
                 split_part(u.email, '@', 1)
               ),
  updated_at = now()
FROM auth.users u
WHERE profiles.user_id = u.id
  AND (profiles.name IS NULL OR TRIM(profiles.name) = '');

-- 2. 본사 active 멤버 → is_super_admin = true 일괄 부여
UPDATE profiles
SET
  is_super_admin = true,
  updated_at     = now()
WHERE user_id IN (
  SELECT m.user_id
  FROM   memberships m
  JOIN   workplaces  w ON w.id = m.workplace_id
  WHERE  w.name     = '본사'
    AND  m.active   = true
);
