-- #############################################################################
-- #
-- #  Relative Weight CLI - Database Schema (DuckDB)
-- #
-- #############################################################################

CREATE SCHEMA IF NOT EXISTS rw;

-- DuckDB does not support CREATE DOMAIN; Fibonacci constraints are enforced
-- via CHECK on each column.
-- DuckDB does not support ON DELETE CASCADE; cascading deletes are handled
-- in application code.
-- DuckDB treats UPDATE as DELETE+INSERT internally, which breaks FK constraints
-- on child tables referencing updated rows. FKs referencing tickets and tags
-- are therefore omitted and enforced in application code.

CREATE TYPE rw.tag_action AS ENUM ('added', 'removed');

-- =============================================================================
--  1. SEQUENCES
-- =============================================================================

CREATE SEQUENCE rw.projects_id_seq;
CREATE SEQUENCE rw.tickets_id_seq;
CREATE SEQUENCE rw.tags_id_seq;
CREATE SEQUENCE rw.tag_revisions_id_seq;
CREATE SEQUENCE rw.ticket_tag_changes_id_seq;
CREATE SEQUENCE rw.ticket_revisions_id_seq;

-- =============================================================================
--  2. PROJECTS (never updated, FKs pointing here are safe)
-- =============================================================================

CREATE TABLE rw.projects (
    id         INTEGER PRIMARY KEY DEFAULT nextval('rw.projects_id_seq'),
    project_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
--  3. TICKETS
-- =============================================================================

CREATE TABLE rw.tickets (
    id          INTEGER PRIMARY KEY DEFAULT nextval('rw.tickets_id_seq'),
    ticket_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    project_id  INTEGER NOT NULL REFERENCES rw.projects(id),
    title       TEXT NOT NULL,
    description TEXT,
    benefit     SMALLINT NOT NULL DEFAULT 1 CHECK (benefit IN (1, 2, 3, 5, 8, 13, 21)),
    penalty     SMALLINT NOT NULL DEFAULT 1 CHECK (penalty IN (1, 2, 3, 5, 8, 13, 21)),
    estimate    SMALLINT NOT NULL DEFAULT 1 CHECK (estimate IN (1, 2, 3, 5, 8, 13, 21)),
    risk        SMALLINT NOT NULL DEFAULT 1 CHECK (risk    IN (1, 2, 3, 5, 8, 13, 21)),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
--  4. TAGS
-- =============================================================================

CREATE TABLE rw.tags (
    id         INTEGER PRIMARY KEY DEFAULT nextval('rw.tags_id_seq'),
    project_id INTEGER NOT NULL REFERENCES rw.projects(id),
    prefix     TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, prefix, value)
);

CREATE TABLE rw.tag_revisions (
    id         INTEGER PRIMARY KEY DEFAULT nextval('rw.tag_revisions_id_seq'),
    tag_id     INTEGER NOT NULL,
    prefix     TEXT NOT NULL,
    value      TEXT NOT NULL,
    revised_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rw.ticket_tags (
    ticket_id   INTEGER NOT NULL,
    tag_id      INTEGER NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (ticket_id, tag_id)
);

-- =============================================================================
--  5. TICKET TAG CHANGES (audit log)
-- =============================================================================

CREATE TABLE rw.ticket_tag_changes (
    id         INTEGER PRIMARY KEY DEFAULT nextval('rw.ticket_tag_changes_id_seq'),
    ticket_id  INTEGER NOT NULL,
    tag_id     INTEGER NOT NULL,
    action     rw.tag_action NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
--  6. TICKET REVISIONS (content snapshot history)
-- =============================================================================

CREATE TABLE rw.ticket_revisions (
    id          INTEGER PRIMARY KEY DEFAULT nextval('rw.ticket_revisions_id_seq'),
    ticket_id   INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    benefit     SMALLINT NOT NULL CHECK (benefit  IN (1, 2, 3, 5, 8, 13, 21)),
    penalty     SMALLINT NOT NULL CHECK (penalty  IN (1, 2, 3, 5, 8, 13, 21)),
    estimate    SMALLINT NOT NULL CHECK (estimate IN (1, 2, 3, 5, 8, 13, 21)),
    risk        SMALLINT NOT NULL CHECK (risk     IN (1, 2, 3, 5, 8, 13, 21)),
    tags        JSON NOT NULL,
    revised_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
--  7. WEIGHT CONFIGURATION (per project)
-- =============================================================================

CREATE TABLE rw.weight_configs (
    project_id INTEGER NOT NULL UNIQUE REFERENCES rw.projects(id),
    w1         DOUBLE NOT NULL DEFAULT 1.5 CHECK (w1 >= 0),
    w2         DOUBLE NOT NULL DEFAULT 1.5 CHECK (w2 >= 0),
    w3         DOUBLE NOT NULL DEFAULT 1.5 CHECK (w3 >= 0),
    w4         DOUBLE NOT NULL DEFAULT 1.5 CHECK (w4 >= 0)
);

-- =============================================================================
--  8. TICKET RELATIONS (bidirectional, peer-level)
-- =============================================================================

CREATE SEQUENCE rw.ticket_relations_id_seq;

CREATE TABLE rw.ticket_relations (
    id            INTEGER PRIMARY KEY DEFAULT nextval('rw.ticket_relations_id_seq'),
    project_id    INTEGER NOT NULL REFERENCES rw.projects(id),
    source_id     INTEGER NOT NULL,
    target_id     INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, source_id, target_id, relation_type)
);

-- #############################################################################
-- #  End of Schema Definition
-- #############################################################################
