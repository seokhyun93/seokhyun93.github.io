-- Reference only: the Worker creates this table automatically on first use
-- (CREATE TABLE IF NOT EXISTS), so this file does not need to be run manually.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  image_key TEXT NOT NULL,
  detail_link TEXT NOT NULL,
  link1_label TEXT, link1_url TEXT,
  link2_label TEXT, link2_url TEXT,
  link3_label TEXT, link3_url TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
