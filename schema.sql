-- schema.sql - D1 Database Schema for EventifyIt
-- Run with: wrangler d1 execute eventifyit-db --file=./schema.sql

-- ============================================
-- EVENTS TABLE
-- Stores all processed calendar events
-- ============================================
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,                    -- UUID
    user_id TEXT NOT NULL,                  -- User identifier
    title TEXT NOT NULL,                    -- Event title
    start_datetime TEXT NOT NULL,           -- ISO 8601 datetime
    end_datetime TEXT NOT NULL,             -- ISO 8601 datetime
    is_all_day INTEGER DEFAULT 0,           -- Boolean: 0=false, 1=true
    location TEXT,                          -- Optional location
    description TEXT,                       -- Optional description
    google_event_id TEXT,                   -- Google Calendar event ID
    google_calendar_link TEXT,              -- Link to event in Google Calendar
    image_key TEXT,                         -- R2 key (for debugging/recovery)
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for querying user's events by date range
CREATE INDEX IF NOT EXISTS idx_events_user_date 
ON events(user_id, start_datetime, end_datetime);

-- Index for looking up by Google event ID
CREATE INDEX IF NOT EXISTS idx_events_google_id 
ON events(google_event_id);

-- ============================================
-- USER TOKENS TABLE
-- Stores OAuth tokens for Google Calendar
-- NOTE: In production, encrypt these tokens!
-- ============================================
CREATE TABLE IF NOT EXISTS user_tokens (
    user_id TEXT PRIMARY KEY,               -- User identifier
    access_token_encrypted TEXT NOT NULL,   -- OAuth access token
    refresh_token_encrypted TEXT NOT NULL,  -- OAuth refresh token
    expires_at TEXT NOT NULL,               -- Token expiration (ISO 8601)
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- PROCESSING HISTORY TABLE (Optional)
-- Track all image processing attempts
-- ============================================
CREATE TABLE IF NOT EXISTS processing_history (
    id TEXT PRIMARY KEY,                    -- UUID
    user_id TEXT NOT NULL,
    workflow_id TEXT,                       -- Cloudflare workflow instance ID
    image_key TEXT NOT NULL,                -- R2 key
    status TEXT NOT NULL,                   -- 'pending', 'success', 'failed'
    error_message TEXT,                     -- Error details if failed
    extracted_data TEXT,                    -- JSON of extracted data
    event_id TEXT REFERENCES events(id),    -- Link to created event
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_processing_user 
ON processing_history(user_id, created_at);

-- ============================================
-- TRIGGER: Update timestamps
-- ============================================
CREATE TRIGGER IF NOT EXISTS events_updated_at
AFTER UPDATE ON events
BEGIN
    UPDATE events SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS user_tokens_updated_at
AFTER UPDATE ON user_tokens
BEGIN
    UPDATE user_tokens SET updated_at = datetime('now') WHERE user_id = NEW.user_id;
END;
