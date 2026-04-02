-- People table
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    importance INTEGER DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
    last_contact DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Meetings table
CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calendar_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    attendees TEXT, -- JSON array
    location TEXT,
    description TEXT,
    prep_notes TEXT,
    importance_score INTEGER DEFAULT 5 CHECK(importance_score >= 1 AND importance_score <= 10),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATETIME,
    priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Follow-ups table
CREATE TABLE IF NOT EXISTS follow_ups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER,
    subject TEXT NOT NULL,
    context TEXT,
    due_date DATETIME NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'completed', 'skipped')),
    priority INTEGER DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- Briefs table
CREATE TABLE IF NOT EXISTS briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE UNIQUE NOT NULL,
    full_content TEXT NOT NULL,
    sms_content TEXT NOT NULL,
    voice_content TEXT NOT NULL,
    priority_score REAL NOT NULL,
    is_high_priority BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Delivery logs table
CREATE TABLE IF NOT EXISTS delivery_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief_id INTEGER NOT NULL,
    delivery_type TEXT CHECK(delivery_type IN ('sms', 'voice', 'email', 'webhook')),
    status TEXT CHECK(status IN ('pending', 'sent', 'failed', 'retrying')),
    recipient TEXT NOT NULL,
    error_message TEXT,
    metadata TEXT, -- JSON object
    delivered_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE CASCADE
);

-- Workflow and smoke-test runs
CREATE TABLE IF NOT EXISTS workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT NOT NULL CHECK(run_type IN ('daily_brief', 'smoke_test')),
    trigger TEXT NOT NULL,
    date_key DATE NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'suppressed')),
    dry_run BOOLEAN DEFAULT 0,
    brief_id INTEGER,
    sms_status TEXT CHECK(sms_status IN ('sent', 'failed', 'suppressed', 'skipped', 'dry_run')),
    voice_status TEXT CHECK(voice_status IN ('sent', 'failed', 'suppressed', 'skipped', 'dry_run')),
    integration_failures TEXT, -- JSON array
    error_message TEXT,
    metadata TEXT, -- JSON object
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);
CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date ON follow_ups(due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_briefs_date ON briefs(date);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_brief_id ON delivery_logs(brief_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_status ON delivery_logs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_run_type ON workflow_runs(run_type);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_date_key ON workflow_runs(date_key);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_trigger ON workflow_runs(trigger);
