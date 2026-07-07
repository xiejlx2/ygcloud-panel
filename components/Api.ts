"use client";

/** 前端统一 fetch：自动处理 { ok, data } / { ok:false, error }。 */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "same-origin",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("PARSE_ERROR", "服务器返回解析失败", res.status);
  }
  const r = json as { ok?: boolean; data?: T; error?: { code: string; message: string } };
  if (r && r.ok === true) return r.data as T;
  if (r && r.ok === false && r.error) {
    throw new ApiError(r.error.code, r.error.message, res.status);
  }
  throw new ApiError("UNKNOWN", "未知错误", res.status);
}
