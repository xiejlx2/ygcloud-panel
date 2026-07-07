/**
 * 初始化代理商主账号。
 * 用法：npm run seed
 * 幂等：若同名账号已存在则跳过。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_RESELLER_USERNAME || "admin";
  const password = process.env.SEED_RESELLER_PASSWORD || "Admin@12345";
  const displayName =
    process.env.SEED_RESELLER_DISPLAY_NAME || "代理商管理员";

  // 生产环境拒绝使用默认弱口令，避免上线后管理员账号被爆破。
  const DEFAULT_WEAK = "Admin@12345";
  if (process.env.NODE_ENV === "production" && password === DEFAULT_WEAK) {
    console.error(
      "[seed] 拒绝在生产环境使用默认弱口令。请先设置强随机的 SEED_RESELLER_PASSWORD 再执行。",
    );
    process.exit(1);
  }
  if (password === DEFAULT_WEAK) {
    console.warn(
      "[seed] 警告：正在使用默认弱口令 Admin@12345，仅供本地开发，请勿用于生产。",
    );
  }

  const existing = await prisma.user.findUnique({
    where: { username },
  });
  if (existing) {
    console.log(`[seed] 用户 "${username}" 已存在，跳过。`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      role: "reseller_admin",
      username,
      passwordHash,
      displayName,
      status: "active",
    },
  });
  console.log(`[seed] 代理商主账号已创建：`);
  console.log(`        id=${user.id}`);
  console.log(`        username=${user.username}`);
  console.log(`        displayName=${user.displayName}`);
}

main()
  .catch((e) => {
    console.error("[seed] 失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
