-- CreateTable
CREATE TABLE "panel_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "panel_name" TEXT,
    "logo_data_url" TEXT,
    "login_subtitle" TEXT,
    "updated_at" DATETIME NOT NULL
);
