import { CheckCircle2, AlertCircle } from "lucide-react";

export default function Toast({ toast }) {
  if (!toast) return null;
  const isErr = toast.kind === "err";
  return (
    <div className={`toast ${isErr ? "toast-err" : ""}`} role="status">
      {isErr ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
      <span>{toast.msg}</span>
    </div>
  );
}
