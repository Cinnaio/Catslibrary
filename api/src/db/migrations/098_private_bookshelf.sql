ALTER TABLE user_bookshelf ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE user_bookshelf ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_bookshelf ADD COLUMN position BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_bookshelf ADD COLUMN organization_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE bookshelf_groups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name)
);
CREATE TABLE bookshelf_group_members (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  PRIMARY KEY (user_id, group_id, novel_id),
  FOREIGN KEY (user_id, group_id) REFERENCES bookshelf_groups(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, novel_id) REFERENCES user_bookshelf(user_id, novel_id) ON DELETE CASCADE
);
CREATE INDEX bookshelf_members_book ON bookshelf_group_members(user_id, novel_id);
