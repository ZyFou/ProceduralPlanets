-- A planet project is a small JSON document ({ metadata, params }) whose
-- params are plain procedural-planets package parameters. The body type is
-- denormalized from params.mode for filtering, and the card thumbnail lives
-- in its own column so listings never have to parse or ship it inline.
CREATE TABLE projects (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_project_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NULL,
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  body_type VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'planet',
  share_code CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_data MEDIUMTEXT NOT NULL,
  content_revision INT UNSIGNED NOT NULL DEFAULT 1,
  thumbnail_mime VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  thumbnail_data MEDIUMBLOB NULL,
  thumbnail_updated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_share_code (share_code),
  UNIQUE KEY uq_projects_user_source (user_id, source_project_id),
  KEY idx_projects_user_updated (user_id, updated_at),
  KEY idx_projects_visibility_updated (visibility, updated_at),
  KEY idx_projects_visibility_type_updated (visibility, body_type, updated_at),
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_projects_visibility CHECK (visibility IN ('private', 'unlisted', 'public')),
  CONSTRAINT chk_projects_body_type CHECK (body_type IN ('planet', 'gas', 'star'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
