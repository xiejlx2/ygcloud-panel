"use client";

import { NotifySettings } from "@/components/NotifySettings";

export default function AdminNotifyPage() {
  return (
    <NotifySettings
      basePath="/api/admin/notify"
      subtitle="服务器到期、回收站销毁、接入凭据失效等事件，自动推送给你"
      scanText="每小时自动同步一次数据并扫描：机器 7/3/1 天及当天到期、进入回收站即将销毁、接入凭据失效同步停摆，命中即推送（同一告警只发一次，不重复轰炸）。"
    />
  );
}
