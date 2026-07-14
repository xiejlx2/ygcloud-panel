"use client";

import { NotifySettings } from "@/components/NotifySettings";

export default function ClientNotifyPage() {
  return (
    <NotifySettings
      basePath="/api/client/notify"
      subtitle="你名下服务器即将到期 / 进入回收站时，自动推送提醒给你"
      scanText="每小时扫描一次你名下的服务器：7/3/1 天及当天到期、进入回收站即将销毁时推送提醒（同一告警只发一次，不重复轰炸）。续费请联系为你开通账号的服务商。"
    />
  );
}
