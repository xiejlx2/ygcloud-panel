-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parent_id" TEXT,
    "role" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "remark" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reseller_api_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "token_key_hint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "token_suffix" TEXT,
    "last_verified_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reseller_api_tokens_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "server_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
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
    "rawJson" TEXT,
    "last_synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "server_cache_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "server_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "ecs_resource_uuid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assigned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "server_assignments_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "server_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "server_assignments_reseller_id_ecs_resource_uuid_fkey" FOREIGN KEY ("reseller_id", "ecs_resource_uuid") REFERENCES "server_cache" ("reseller_id", "ecs_resource_uuid") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reseller_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_role" TEXT NOT NULL,
    "ecs_resource_uuid" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestPayload" TEXT,
    "async_task_uuid" TEXT,
    "task_status" TEXT,
    "process_result" TEXT,
    "err_msg" TEXT,
    "request_ip" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "operation_logs_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "operation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_parent_id_idx" ON "users"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_api_tokens_reseller_id_key" ON "reseller_api_tokens"("reseller_id");

-- CreateIndex
CREATE INDEX "server_cache_reseller_id_idx" ON "server_cache"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_cache_reseller_id_ecs_resource_uuid_key" ON "server_cache"("reseller_id", "ecs_resource_uuid");

-- CreateIndex
CREATE INDEX "server_assignments_customer_id_idx" ON "server_assignments"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_assignments_reseller_id_ecs_resource_uuid_key" ON "server_assignments"("reseller_id", "ecs_resource_uuid");

-- CreateIndex
CREATE INDEX "operation_logs_reseller_id_created_at_idx" ON "operation_logs"("reseller_id", "created_at");

-- CreateIndex
CREATE INDEX "operation_logs_user_id_created_at_idx" ON "operation_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "operation_logs_ecs_resource_uuid_idx" ON "operation_logs"("ecs_resource_uuid");
