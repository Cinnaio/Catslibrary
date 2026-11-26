-- Source events and their delivery jobs commit together. No backfill of historical activity.
CREATE TABLE notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  replies BOOLEAN NOT NULL DEFAULT true,
  tasks BOOLEAN NOT NULL DEFAULT true,
  preview BOOLEAN NOT NULL DEFAULT false,
  quiet_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end TEXT NOT NULL DEFAULT '08:00',
  time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notification_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL REFERENCES user_sessions(token_hash) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  vapid_public_key TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  test_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX notification_subscriptions_user ON notification_subscriptions(user_id);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reply','task','test','chapters')),
  reference_id TEXT NOT NULL,
  novel_id TEXT NOT NULL DEFAULT '',
  new_chapters INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  read_at BIGINT,
  UNIQUE(user_id, kind, reference_id)
);
CREATE INDEX notifications_user_created ON notifications(user_id,created_at DESC,id DESC);
CREATE INDEX notifications_retention ON notifications(created_at);
CREATE TABLE notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at BIGINT NOT NULL,
  lease TEXT NOT NULL DEFAULT '',
  UNIQUE(notification_id,subscription_id)
);
CREATE INDEX notification_deliveries_due ON notification_deliveries(state,available_at);
CREATE FUNCTION enqueue_notification_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_deliveries(notification_id,subscription_id,available_at)
  SELECT NEW.id,s.id,NEW.created_at FROM notification_subscriptions s
  JOIN user_sessions session ON session.token_hash=s.session_hash
  WHERE s.user_id=NEW.user_id AND session.expires_at>NEW.created_at
    AND (NEW.kind<>'test' OR s.id=NEW.reference_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER notification_push_jobs AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_notification_push();
CREATE FUNCTION notify_comment_reply() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NEW.status='visible' THEN
    INSERT INTO notifications(id,user_id,kind,reference_id,novel_id,created_at)
    SELECT md5('reply:'||NEW.id||':'||p.user_id),p.user_id,'reply',NEW.id,NEW.novel_id,
      (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT
    FROM novel_comments p JOIN users u ON u.id=p.user_id
    WHERE p.id=NEW.parent_id AND p.status='visible' AND p.user_id<>NEW.user_id AND u.status='active'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER notification_comment_reply AFTER INSERT OR UPDATE OF status ON novel_comments
  FOR EACH ROW EXECUTE FUNCTION notify_comment_reply();
CREATE FUNCTION notify_ai_task_result() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('completed','failed') AND OLD.status NOT IN ('completed','failed','cancelled') THEN
    INSERT INTO notifications(id,user_id,kind,reference_id,novel_id,created_at)
    SELECT md5('task:'||NEW.id||':'||NEW.user_id),NEW.user_id,'task',NEW.id,NEW.novel_id,
      (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT
    FROM users WHERE id=NEW.user_id AND status='active'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER notification_ai_task AFTER UPDATE OF status ON ai_tasks FOR EACH ROW EXECUTE FUNCTION notify_ai_task_result();

-- Watches belong to private favorites; removing a favorite also stops its reminders.
CREATE TABLE notification_book_watches (
  user_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  known_urls JSONB,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(user_id,novel_id),
  FOREIGN KEY(user_id,novel_id) REFERENCES user_bookshelf(user_id,novel_id) ON DELETE CASCADE
);

CREATE INDEX notification_report_task ON novel_analysis_reports(task_id,user_id);
