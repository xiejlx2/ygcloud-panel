// 通用 API 响应辅助类型

export type Role = "reseller_admin" | "customer";

export interface SessionUser {
  id: string;
  role: Role;
  parentId: string | null;
  displayName: string;
}

// 统一的成功响应
export interface ApiOk<T> {
  ok: true;
  data: T;
}

// 统一的失败响应
export interface ApiErr {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResult<T> = ApiOk<T> | ApiErr;
