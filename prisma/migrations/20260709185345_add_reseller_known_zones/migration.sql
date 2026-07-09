-- CreateTable
CREATE TABLE "reseller_known_zones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "region_name" TEXT,
    "zone_code" TEXT NOT NULL,
    "zone_name" TEXT,
    "machine_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reseller_known_zones_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "reseller_known_zones_reseller_id_idx" ON "reseller_known_zones"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_known_zones_reseller_id_region_code_zone_code_key" ON "reseller_known_zones"("reseller_id", "region_code", "zone_code");
