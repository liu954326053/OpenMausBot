import { useState } from "react";
import { Info, type LucideIcon } from "lucide-react";

export interface ToastMessage {
  text: string;
  icon?: LucideIcon;
  key: number;
}

export function Toast({ message }: { message: ToastMessage | null }) {
  const [last, setLast] = useState(message);
  if (message && message !== last) setLast(message);
  const shown = message ?? last;
  const Icon = shown?.icon ?? Info;
  return (
    <div className={message ? "toast is-on" : "toast"} role="status" aria-live="polite">
      {shown ? (
        <>
          <Icon className="ic" aria-hidden="true" />
          <span key={shown.key}>{shown.text}</span>
        </>
      ) : null}
    </div>
  );
}
