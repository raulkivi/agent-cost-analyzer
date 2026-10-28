CREATE TABLE sessions (
				session_uri TEXT PRIMARY KEY NOT NULL,
				provider    TEXT NOT NULL,
				start_time  INTEGER NOT NULL
			, external INTEGER, registration_source TEXT NOT NULL DEFAULT 'explicit', modified_time INTEGER NOT NULL DEFAULT 0);

CREATE TABLE metadata (
				key   TEXT PRIMARY KEY NOT NULL,
				value TEXT NOT NULL
			);

CREATE TABLE sessions_v2 (
	session_uri         TEXT PRIMARY KEY NOT NULL,
	provider            TEXT NOT NULL,
	start_time          INTEGER NOT NULL,
	external            INTEGER,
	registration_source TEXT NOT NULL,
	session_generation  TEXT,
	source_revision     INTEGER CHECK (source_revision >= 0),
	payload_version     INTEGER CHECK (payload_version >= 0),
	payload_hash        TEXT,
	verified            INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
	payload             TEXT,
	is_chat_backing     INTEGER NOT NULL DEFAULT 0 CHECK (is_chat_backing IN (0, 1)),
	modified_time       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE session_chat_catalogs (
		session_uri              TEXT PRIMARY KEY NOT NULL,
		revision                 INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
		legacy_mirrored_revision INTEGER NOT NULL DEFAULT 0 CHECK (legacy_mirrored_revision >= 0)
	, authority_version INTEGER NOT NULL DEFAULT 1 CHECK (authority_version IN (1, 2)), default_chat_uri TEXT, session_generation TEXT, normalization_source_revision INTEGER, normalization_payload_hash TEXT, projected_revision INTEGER);

CREATE TABLE session_chats (
		session_uri       TEXT NOT NULL REFERENCES session_chat_catalogs(session_uri) ON DELETE CASCADE,
		chat_uri          TEXT NOT NULL,
		chat_order        INTEGER NOT NULL CHECK (chat_order >= 0),
		provider_data     TEXT,
		origin            TEXT,
		inherited_turn_id TEXT, archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)), is_read INTEGER CHECK (is_read IN (0, 1)),
		PRIMARY KEY (session_uri, chat_uri),
		UNIQUE (session_uri, chat_order)
	);

CREATE TABLE chats_v2 (
	chat_uri TEXT PRIMARY KEY NOT NULL,
	owner_session_uri TEXT NOT NULL,
	chat_order INTEGER CHECK (chat_order >= 0),
	storage_resource TEXT,
	parent_chat TEXT,
	provider_data TEXT,
	origin TEXT,
	is_read INTEGER CHECK (is_read IN (0, 1)),
	archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
	inherited_turn_id TEXT,
	working_directories TEXT,
	metadata TEXT NOT NULL,
	metadata_hash TEXT NOT NULL,
	ownership_revision INTEGER NOT NULL DEFAULT 0 CHECK (ownership_revision >= 0),
	metadata_revision INTEGER NOT NULL DEFAULT 0 CHECK (metadata_revision >= 0),
	tombstoned INTEGER NOT NULL DEFAULT 0 CHECK (tombstoned IN (0, 1))
, origin_session_uri TEXT);

CREATE TABLE session_state (
	session_uri              TEXT PRIMARY KEY NOT NULL,
	revision                 INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
	legacy_mirrored_revision INTEGER NOT NULL DEFAULT 0 CHECK (legacy_mirrored_revision >= 0),
	rows_revision            INTEGER NOT NULL DEFAULT 0 CHECK (rows_revision >= 0),
	rows_mirrored_revision   INTEGER NOT NULL DEFAULT 0 CHECK (rows_mirrored_revision >= 0),
	import_version           INTEGER NOT NULL CHECK (import_version >= 1)
);

CREATE TABLE session_state_values (
	session_uri TEXT NOT NULL,
	key         TEXT NOT NULL,
	value       TEXT,
	revision    INTEGER NOT NULL CHECK (revision >= 0),
	PRIMARY KEY (session_uri, key)
) WITHOUT ROWID;

CREATE TABLE session_folder_state (
	session_uri      TEXT NOT NULL,
	folder_key       TEXT NOT NULL,
	kind             TEXT NOT NULL CHECK (kind IN ('git', 'github', 'baseBranch')),
	value            TEXT,
	storage_resource TEXT,
	revision         INTEGER NOT NULL CHECK (revision >= 0),
	PRIMARY KEY (session_uri, folder_key, kind)
) WITHOUT ROWID;

CREATE TABLE session_chat_state (
	session_uri                TEXT NOT NULL,
	chat_uri                   TEXT NOT NULL,
	is_default                 INTEGER NOT NULL CHECK (is_default IN (0, 1)),
	storage_resource           TEXT,
	title                      TEXT,
	title_source               TEXT CHECK (title_source IS NULL OR title_source IN ('user', 'agent', 'auto')),
	is_read                    INTEGER CHECK (is_read IN (0, 1)),
	working_directories        TEXT,
	launch_working_directories TEXT,
	changes_summary            TEXT,
	revision                   INTEGER NOT NULL CHECK (revision >= 0),
	PRIMARY KEY (session_uri, chat_uri)
) WITHOUT ROWID;

CREATE TABLE chat_row_mirror (
	session_uri TEXT NOT NULL,
	chat_uri    TEXT NOT NULL,
	kind        TEXT NOT NULL CHECK (kind IN ('draft', 'localTurns')),
	base        TEXT NOT NULL,
	PRIMARY KEY (session_uri, chat_uri, kind)
) WITHOUT ROWID;

CREATE TABLE worktree_co_owners (
	worktree_path   TEXT NOT NULL,
	session_uri     TEXT NOT NULL,
	repository_root TEXT NOT NULL,
	branch          TEXT NOT NULL,
	PRIMARY KEY (worktree_path, session_uri)
) WITHOUT ROWID;

CREATE TABLE "pending_worktree_removals" (
	kind            TEXT NOT NULL CHECK (kind IN ('session', 'detached', 'coOwned')),
	owner           TEXT NOT NULL,
	owner_session   TEXT,
	worktree_path   TEXT NOT NULL,
	repository_root TEXT NOT NULL,
	branch          TEXT,
	mode            TEXT NOT NULL CHECK (mode IN ('commit', 'synced', 'delete')),
	owner_deleted   INTEGER NOT NULL DEFAULT 0 CHECK (owner_deleted IN (0, 1)),
	attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
	requested_at    INTEGER NOT NULL,
	next_attempt_at INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (kind, owner)
) WITHOUT ROWID;

CREATE TABLE scratch_folders (
	folder          TEXT NOT NULL PRIMARY KEY,
	chat_uri        TEXT NOT NULL,
	provider        TEXT NOT NULL,
	state           TEXT NOT NULL CHECK (state IN ('allocating', 'owned', 'removing')),
	requested_at    INTEGER NOT NULL,
	attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
	next_attempt_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
