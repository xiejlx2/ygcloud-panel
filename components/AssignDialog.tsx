"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/components/Api";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { IconSpinner } from "@/components/Icons";

interface Customer {
  id: string;
  username: string;
  displayName: string;
  status: string;
}

interface Props {
  open: boolean;
  uuids: string[];
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignDialog({ open, uuids, onClose, onAssigned }: Props) {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api<{ items: Customer[] }>("/api/admin/customers")
      .then((r) => {
        const active = r.items.filter((c) => c.status !== "disabled");
        setCustomers(active);
        setCustomerId(active[0]?.id ?? "");
      })
      .catch(() => void 0);
  }, [open]);

  async function submit() {
    if (!customerId) return setError("请选择客户");
    setLoading(true);
    setError(null);
    try {
      await api("/api/admin/assignments", {
        method: "POST",
        body: JSON.stringify({ customerId, ecsResourceUUIDs: uuids }),
      });
      toast.success(`已分配 ${uuids.length} 台服务器`);
      onAssigned();
      onClose();
    } catch (e) {
      setError((e as ApiError).message || "分配失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="分配服务器给客户"
      footer={
        <>
          <button className="btn-default" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={loading || !customerId}
            onClick={submit}
          >
            {loading && <IconSpinner className="h-4 w-4" />}
            确认分配
          </button>
        </>
      }
    >
      <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        已选 <span className="font-medium text-slate-700">{uuids.length}</span> 台服务器
      </div>
      <label className="label">选择客户</label>
      <select
        className="select"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      >
        {customers.length === 0 ? (
          <option value="">（暂无可用客户）</option>
        ) : (
          customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}（{c.username}）
            </option>
          ))
        )}
      </select>
      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </Modal>
  );
}
