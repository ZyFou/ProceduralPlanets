CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(320) NOT NULL,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(80) NULL,
  website_url VARCHAR(2048) NULL,
  default_project_visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  avatar_mime_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  avatar_data MEDIUMBLOB NULL,
  avatar_updated_at DATETIME(3) NULL,
  email_verified_at DATETIME(3) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_status (status),
  KEY idx_users_role_status (role, status),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'suspended', 'deleted')),
  CONSTRAINT chk_users_role CHECK (role IN ('user', 'admin')),
  CONSTRAINT chk_users_default_project_visibility
    CHECK (default_project_visibility IN ('private', 'unlisted', 'public'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash BINARY(32) NOT NULL,
  user_agent VARCHAR(512) NULL,
  ip_address VARCHAR(45) NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user_id (user_id),
  KEY idx_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
