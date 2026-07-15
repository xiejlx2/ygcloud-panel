/**
 * 面板自助更新（一键升级）。
 *
 * GET  /api/admin/update            → 版本对比 + 当前更新进度（enabled=false 表示本环境未开启）
 * GET  /api/admin/update?check=1    → 先 git fetch 再对比（「检查更新」按钮）
 * POST /api/admin/update            → 触发一次更新（单飞；已是最新则拒绝）
 *
 * 仅 reseller_admin 可调用；需部署方在 .env 显式 SELF_UPDATE_ENABLED=1 才生效。
 */
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import {
  getUpdateConfig,
  getGitVersion,
  readStatus,
  isRunning,
  spawnUpdater,
} from "@/lib/selfUpdate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const cfg = getUpdateConfig();
    if (!cfg.enabled) return ok({ enabled: false });

    const doFetch = req.nextUrl.searchParams.get("check") === "1";
    const version = await getGitVersion(doFetch);
    const status = await readStatus();

    return ok({
      enabled: true,
      branch: cfg.branch,
      canRestart: !!cfg.restartCmd,
      version,
      status,
      running: isRunning(status),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const cfg = getUpdateConfig();
    if (!cfg.enabled) return err("DISABLED", "本环境未开启自助更新", 503);

    const current = await readStatus();
    if (isRunning(current)) return err("BUSY", "已有更新任务进行中，请稍候", 409);

    const ver = await getGitVersion(true);
    if (ver.behind <= 0) return err("UP_TO_DATE", "已是最新版本，无需更新", 400);

    const { oldCommit } = await spawnUpdater(user);
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "panel_update",
      requestPayload: { from: oldCommit, behind: ver.behind, branch: cfg.branch },
    });

    return ok({ started: true, from: oldCommit, behind: ver.behind });
  } catch (e) {
    return handleError(e);
  }
}
