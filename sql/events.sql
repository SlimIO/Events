-- PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "entity" (
    "id" INTEGER PRIMARY KEY NOT NULL,
    "uuid" CHAR(36) NOT NULL,
    "parent" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(75) DEFAULT 'N/A' NOT NULL,
    "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_parent_id FOREIGN KEY("parent") REFERENCES entity("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "entity_oids" (
    "entity_id" INTEGER NOT NULL,
    "oid" VARCHAR(255) NOT NULL,
    CONSTRAINT fk_entity_id FOREIGN KEY("entity_id") REFERENCES entity("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "entity_descriptor" (
    "entity_id" INTEGER NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_entity_id FOREIGN KEY("entity_id") REFERENCES entity("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "metric_identity_card" (
    "id" INTEGER PRIMARY KEY NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "description" VARCHAR(75) NOT NULL,
    "sample_unit" VARCHAR(50) NOT NULL,
    "sample_interval" SMALLINT DEFAULT 5 NOT NULL,
    "sample_max_value" INTEGER,
    "aggregation_mode" TINYINT DEFAULT 0 NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_entity_id FOREIGN KEY("entity_id") REFERENCES entity("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "alarms" (
    "id" INTEGER PRIMARY KEY NOT NULL,
    "uuid" CHAR(36) NOT NULL,
    "open" BOOLEAN DEFAULT 1 NOT NULL,
    "message" VARCHAR(200) NOT NULL,
    "severity" TINYINT DEFAULT 4 NOT NULL,
    "createdAt" REAL DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" REAL DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "occurence" UNSIGNED MEDIUMINT DEFAULT 0 NOT NULL,
    "entity_uuid" CHAR(36) NOT NULL,
    CONSTRAINT fk_entity_uuid FOREIGN KEY("entity_uuid") REFERENCES entity("uuid") ON DELETE CASCADE
);
