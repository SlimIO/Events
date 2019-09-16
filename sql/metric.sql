CREATE TABLE IF NOT EXISTS "metrics" (
    "value" INTEGER NOT NULL,
    "harvestedAt" DATETIME NOT NULL,
    "level" TINYINT DEFAULT 0 NOT NULL
);
