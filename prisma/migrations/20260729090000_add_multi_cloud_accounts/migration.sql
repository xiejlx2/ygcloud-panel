-- Rebuild ResellerApiToken: one reseller may own multiple named cloud accounts.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_reseller_api_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL DEFAULT '默认账户',
    "token_encrypted" TEXT NOT NULL,
    "token_key_hint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "token_suffix" TEXT,
    "last_verified_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reseller_api_tokens_reseller_id_fkey"
      FOREIGN KEY ("reseller_id") REFERENCES "users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_reseller_api_tokens" (
    "id", "reseller_id", "account_name", "token_encrypted", "token_key_hint",
    "status", "token_suffix", "last_verified_at", "created_at", "updated_at"
)
SELECT
    "id", "reseller_id", '默认账户', "token_encrypted", "token_key_hint",
    "status", "token_suffix", "last_verified_at", "created_at", "updated_at"
FROM "reseller_api_tokens";

DROP TABLE "reseller_api_tokens";
ALTER TABLE "new_reseller_api_tokens" RENAME TO "reseller_api_tokens";
CREATE INDEX "reseller_api_tokens_reseller_id_idx"
  ON "reseller_api_tokens"("reseller_id");
CREATE UNIQUE INDEX "reseller_api_tokens_reseller_id_account_name_key"
  ON "reseller_api_tokens"("reseller_id", "account_name");

-- Rebuild ServerCache and bind existing rows to their reseller's former single Key.
CREATE TABLE "new_server_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "api_token_id" TEXT,
    "ecs_resource_uuid" TEXT NOT NULL,
    "instance_name" TEXT,
    "public_ip_address" TEXT,
    "internal_ip_address" TEXT,
    "region_code" TEXT,
    "region_name" TEXT,
    "zone_code" TEXT,
    "zone_name" TEXT,
    "cpu" INTEGER,
    "memory" INTEGER,
    "bandwidth" INTEGER,
    "os_name" TEXT,
    "os_version_detail" TEXT,
    "ecs_status" TEXT,
    "ecs_pending_status" TEXT,
    "expire_time" DATETIME,
    "customer_alias" TEXT,
    "customer_note" TEXT,
    "rawJson" TEXT,
    "last_synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "server_cache_reseller_id_fkey"
      FOREIGN KEY ("reseller_id") REFERENCES "users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "server_cache_api_token_id_fkey"
      FOREIGN KEY ("api_token_id") REFERENCES "reseller_api_tokens" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_server_cache" (
    "id", "reseller_id", "api_token_id", "ecs_resource_uuid", "instance_name",
    "public_ip_address", "internal_ip_address", "region_code", "region_name",
    "zone_code", "zone_name", "cpu", "memory", "bandwidth", "os_name",
    "os_version_detail", "ecs_status", "ecs_pending_status", "expire_time",
    "customer_alias", "customer_note", "rawJson", "last_synced_at",
    "created_at", "updated_at"
)
SELECT
    s."id", s."reseller_id",
    (SELECT t."id" FROM "reseller_api_tokens" t
      WHERE t."reseller_id" = s."reseller_id"
      ORDER BY t."created_at" ASC LIMIT 1),
    s."ecs_resource_uuid", s."instance_name", s."public_ip_address",
    s."internal_ip_address", s."region_code", s."region_name", s."zone_code",
    s."zone_name", s."cpu", s."memory", s."bandwidth", s."os_name",
    s."os_version_detail", s."ecs_status", s."ecs_pending_status",
    s."expire_time", s."customer_alias", s."customer_note", s."rawJson",
    s."last_synced_at", s."created_at", s."updated_at"
FROM "server_cache" s;

DROP TABLE "server_cache";
ALTER TABLE "new_server_cache" RENAME TO "server_cache";
CREATE INDEX "server_cache_reseller_id_idx" ON "server_cache"("reseller_id");
CREATE INDEX "server_cache_api_token_id_idx" ON "server_cache"("api_token_id");
CREATE UNIQUE INDEX "server_cache_reseller_id_ecs_resource_uuid_key"
  ON "server_cache"("reseller_id", "ecs_resource_uuid");

-- Known zones are account-specific; otherwise one Key could be asked to scan
-- another account's private/downlisted zones and make every sync incomplete.
CREATE TABLE "new_reseller_known_zones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "api_token_id" TEXT,
    "region_code" TEXT NOT NULL,
    "region_name" TEXT,
    "zone_code" TEXT NOT NULL,
    "zone_name" TEXT,
    "machine_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reseller_known_zones_reseller_id_fkey"
      FOREIGN KEY ("reseller_id") REFERENCES "users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reseller_known_zones_api_token_id_fkey"
      FOREIGN KEY ("api_token_id") REFERENCES "reseller_api_tokens" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_reseller_known_zones" (
    "id", "reseller_id", "api_token_id", "region_code", "region_name",
    "zone_code", "zone_name", "machine_count", "last_seen_at",
    "created_at", "updated_at"
)
SELECT
    z."id", z."reseller_id",
    (SELECT t."id" FROM "reseller_api_tokens" t
      WHERE t."reseller_id" = z."reseller_id"
      ORDER BY t."created_at" ASC LIMIT 1),
    z."region_code", z."region_name", z."zone_code", z."zone_name",
    z."machine_count", z."last_seen_at", z."created_at", z."updated_at"
FROM "reseller_known_zones" z;

DROP TABLE "reseller_known_zones";
ALTER TABLE "new_reseller_known_zones" RENAME TO "reseller_known_zones";
CREATE INDEX "reseller_known_zones_reseller_id_idx"
  ON "reseller_known_zones"("reseller_id");
CREATE INDEX "reseller_known_zones_api_token_id_idx"
  ON "reseller_known_zones"("api_token_id");
CREATE UNIQUE INDEX "reseller_known_zones_api_token_id_region_code_zone_code_key"
  ON "reseller_known_zones"("api_token_id", "region_code", "zone_code");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
