CREATE TABLE IF NOT EXISTS "metrics" (
    "value" INTEGER NOT NULL,
    "type" CHAR(3) DEFAULT "raw" NOT NULL,
    "harvestedAt" DATETIME NOT NULL,
    "level" TINYINT DEFAULT 0 NOT NULL
);
