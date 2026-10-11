-- 旧记录采用新的默认策略；之后由管理操作明确记录用户偏好。
ALTER TABLE novel_followups ADD COLUMN user_configured BOOLEAN NOT NULL DEFAULT FALSE;
