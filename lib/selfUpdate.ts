/**
 * 面板自助更新（一键升级）核心逻辑。
 *
 * 设计要点：
 * - 版本对比走 git（execFile 数组传参，绝不过 shell，无注入面）。
 * - 触发更新时，用 systemd-run 起一个独立的 transient 服务单元执行 scripts/self-update.sh，
 *   使其脱离主服务 cgroup —— build 完 `systemctl restart` 杀主服务时不会连它一起杀。
 * - 更新进度写入 <PANEL_DIR>/.update-status.json，前端轮询读取。
 *
 * 仅在服务端使用。
 */
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import type { SessionUser } from "@/lib/types";

const pexec = promisify(execFile);

export interface UpdateConfig {
  enabled: boolean;
  branch: string;
  restartCmd: string;
  panelDir: string;
  dbFile: string | null;
  statusFile: string;
  logDir: string;
  scriptPath: string;
}

/** 从环境解析更新配置。panelDir 取进程工作目录（生产 = /opt/ygcloud-panel）。 */
export function getUpdateConfig(): UpdateConfig {
  const panelDir = process.cwd();
  return {
    enabled: env.SELF_UPDATE_ENABLED,
    branch: env.SELF_UPDATE_BRANCH,
    restartCmd: env.SELF_UPDATE_RESTART_CMD,
    panelDir,
    dbFile: resolveDbFile(panelDir),
    statusFile: path.join(panelDir, ".update-status.json"),
    logDir: path.join(panelDir, "backups"),
    scriptPath: path.join(panelDir, "scripts", "self-update.sh"),
  };
}

/** 由 DATABASE_URL 推导 sqlite 文件绝对路径（file:./prod.db 相对 prisma/ 目录解析）。非 sqlite 返回 null。 */
function resolveDbFile(panelDir: string): string | null {
  const url = process.env.DATABASE_URL || "";
  const m = url.match(/^file:(.+)$/);
  if (!m) return null;
  let p = m[1].trim();
  if (!path.isAbsolute(p)) p = path.resolve(panelDir, "prisma", p);
  return p;
}

export interface PendingCommit {
  commit: string;
  subject: string;
}

export interface GitVersion {
  commit: string; // 当前 HEAD 短 SHA
  subject: string;
  committedAt: string; // ISO
  behind: number; // 落后 origin/<branch> 的提交数
  pending: PendingCommit[]; // 待更新的提交（新→旧）
  fetchError?: string; // git fetch 失败时的说明（不阻断，仅用本地已知 origin 对比）
}

const US = "\x1f"; // 单元分隔符，做字段分隔，避免主题里出现的字符冲突

/** 读取当前版本并（可选）先 fetch 再与 origin/<branch> 对比。 */
export async function getGitVersion(doFetch: boolean): Promise<GitVersion> {
  const { panelDir, branch } = getUpdateConfig();
  const git = (args: string[]) =>
    pexec("git", args, { cwd: panelDir, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });

  const head = (await git(["log", "-1", `--format=%h${US}%s${US}%cI`])).stdout.trim();
  const [commit, subject, committedAt] = head.split(US);

  let fetchError: string | undefined;
  if (doFetch) {
    try {
      await git(["fetch", "--quiet", "origin", branch]);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
  }

  let behind = 0;
  let pending: PendingCommit[] = [];
  try {
    const cnt = (await git(["rev-list", "--count", `HEAD..origin/${branch}`])).stdout.trim();
    behind = Number(cnt) || 0;
    if (behind > 0) {
      const raw = (
        await git(["log", `HEAD..origin/${branch}`, `--format=%h${US}%s`])
      ).stdout.trim();
      pending = raw
        ? raw.split("\n").map((l) => {
            const [c, s] = l.split(US);
            return { commit: c, subject: s };
          })
        : [];
    }
  } catch {
    // origin/<branch> 不存在（未 fetch 过等）—— 视为无可用更新信息
  }

  return { commit, subject, committedAt, behind, pending, fetchError };
}

export type UpdatePhase =
  | "starting"
  | "backup"
  | "pull"
  | "install"
  | "migrate"
  | "build"
  | "restart"
  | "rollback"
  | "done"
  | "error";

export interface UpdateStatus {
  phase: UpdatePhase;
  startedAt: string;
  finishedAt: string | null;
  oldCommit: string | null;
  newCommit: string | null;
  ok: boolean | null;
  error: string | null;
  logTail: string | null;
  triggeredBy: string | null;
}

const TERMINAL: UpdatePhase[] = ["done", "error"];

export async function readStatus(): Promise<UpdateStatus | null> {
  const { statusFile } = getUpdateConfig();
  try {
    const raw = await fs.readFile(statusFile, "utf8");
    return JSON.parse(raw) as UpdateStatus;
  } catch {
    return null;
  }
}

async function writeStatus(s: UpdateStatus): Promise<void> {
  const { statusFile } = getUpdateConfig();
  const tmp = `${statusFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await fs.rename(tmp, statusFile);
}

/** 是否有更新任务仍在进行（非终态且开始时间在 20 分钟内；超时视为脚本已崩，允许重试）。 */
export function isRunning(s: UpdateStatus | null): boolean {
  if (!s) return false;
  if (TERMINAL.includes(s.phase)) return false;
  const started = Date.parse(s.startedAt);
  if (!Number.isFinite(started)) return false;
  return Date.now() - started < 20 * 60 * 1000;
}

/**
 * 启动更新：写初始状态 → systemd-run 起独立单元执行脚本。
 * 立即返回；进度由脚本回写状态文件、前端轮询。
 */
export async function spawnUpdater(user: SessionUser): Promise<{ oldCommit: string }> {
  const cfg = getUpdateConfig();
  const ver = await getGitVersion(false);
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(cfg.logDir, `update-${ts}.log`);

  await fs.mkdir(cfg.logDir, { recursive: true }).catch(() => void 0);

  await writeStatus({
    phase: "starting",
    startedAt: now.toISOString(),
    finishedAt: null,
    oldCommit: ver.commit,
    newCommit: null,
    ok: null,
    error: null,
    logTail: null,
    triggeredBy: user.id,
  });

  const unit = `panel-selfupdate-${ts}`;
  // 把父进程的 PATH 传入 transient 单元，确保 node/npm/git/systemctl 可解析。
  const args = [
    `--unit=${unit}`,
    "--collect",
    `--setenv=PATH=${process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`,
    `--setenv=PANEL_DIR=${cfg.panelDir}`,
    `--setenv=BRANCH=${cfg.branch}`,
    `--setenv=RESTART_CMD=${cfg.restartCmd}`,
    `--setenv=DB_FILE=${cfg.dbFile || ""}`,
    `--setenv=STATUS_FILE=${cfg.statusFile}`,
    `--setenv=LOG_FILE=${logFile}`,
    `--setenv=OLD_COMMIT=${ver.commit}`,
    `--setenv=TRIGGERED_BY=${user.id}`,
    "/bin/bash",
    cfg.scriptPath,
  ];

  try {
    // systemd-run 起 transient 服务后立即返回（不阻塞在脚本上）。
    await pexec("systemd-run", args, { timeout: 20000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 启动失败：把状态置为 error，避免 isRunning 卡住后续重试。
    await writeStatus({
      phase: "error",
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      oldCommit: ver.commit,
      newCommit: null,
      ok: false,
      error: `启动更新任务失败：${msg}`,
      logTail: null,
      triggeredBy: user.id,
    });
    throw e;
  }

  return { oldCommit: ver.commit };
}
