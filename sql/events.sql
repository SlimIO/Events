-- PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "entity" (
"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
"uid" CHAR(36) NOT NULL,
"parent" INTEGER,
"name" VARCHAR(100) NOT NULL,
"description" VARCHAR(75) NOT NULL,
CONSTRAINT fk_parent_id FOREIGN KEY("parent") REFERENCES entity("id") ON DELETE CASCADE
)

CREATE TABLE IF NOT EXISTS "entity_descriptor" (
"entity_id" INTEGER NOT NULL,
"key" VARCHAR(40) NOT NULL,
"value" VARCHAR(100) NOT NULL,
CONSTRAINT fk_entity_id FOREIGN KEY("entity_id") REFERENCES entity("id") ON DELETE CASCADE
)

CREATE TABLE IF NOT EXISTS "metric_identity_card" (
"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
"name" VARCHAR(40) NOT NULL,
"description" VARCHAR(75) NOT NULL,
"sample_unit" UNSIGNED TINYINT NOT NULL,
"sample_interval" SMALLINT NOT NULL,
"sample_max_value" INTEGER,
"aggregation_mode" TINYINT DEFAULT 0 NOT NULL,
"entity_id" INTEGER NOT NULL,
CONSTRAINT fk_entity_id FOREIGN KEY("entity_id") REFERENCES entity("id") ON DELETE CASCADE
)

CREATE TABLE IF NOT EXISTS "event_subscriber" (
"subscriber_name" VARCHAR(40) NOT NULL,
"event_type" VARCHAR(30) NOT NULL,
"createdAt" DATETIME DEFAULT NOW NOT NULL,
"updatedAt" DATETIME DEFAULT NOW NOT NULL
)
