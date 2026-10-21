-- Pause requests never release a running worker's lease.
ALTER TABLE novel_story_memory_builds ADD COLUMN pause_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE novel_story_memory_builds ADD COLUMN target_chapter_id TEXT NOT NULL DEFAULT '';
