-- CreateTable
CREATE TABLE "reseller_notify_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "telegram_bot_token_encrypted" TEXT,
    "telegram_token_suffix" TEXT,
    "telegram_key_hint" TEXT,
    "telegram_chat_id" TEXT,
    "webhook_type" TEXT,
    "webhook_url_encrypted" TEXT,
    "webhook_key_hint" TEXT,
    "last_run_at" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reseller_notify_configs_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channels" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "detail" TEXT,
    "sent_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "reseller_notify_configs_reseller_id_key" ON "reseller_notify_configs"("reseller_id");

-- CreateIndex
CREATE INDEX "notification_logs_reseller_id_sent_at_idx" ON "notification_logs"("reseller_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_reseller_id_dedup_key_key" ON "notification_logs"("reseller_id", "dedup_key");
