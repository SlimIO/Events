CREATE TABLE IF NOT EXISTS "alarms" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "uid" CHAR(36) NOT NULL,
    "open" BOOLEAN DEFAULT 1 NOT NULL,
    "message" VARCHAR(200) NOT NULL,
    "severity" TINYINT DEFAULT 4 NOT NULL,
    "createdAt" REAL DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" REAL DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "occurence" UNSIGNED MEDIUMINT DEFAULT 0 NOT NULL,
    "entity_uid" CHAR(36)
)

-- 8 + 36 + 1 + 200  + 1 + 8 + 8 + 3 + 36 = 301bytes