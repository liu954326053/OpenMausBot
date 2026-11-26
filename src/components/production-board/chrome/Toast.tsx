import { useState } from "react";
import { Info, type LucideIcon } from "lucide-react";
import { centredInRoom } from "./room";

export interface ToastMessage {
  text: string;
  icon?: LucideIcon;
  key: number;
}

export function Toast({ message, insetEnd = 0 }: { message: ToastMessage | null; insetEnd?: number }) {
  const [last, setLast] = useState(message);
  if (message && message !== last) setLast(message);
  const shown = message ?? last;
  const Icon = shown?.icon ?? Info;
  return (
    <div className={message ? "toast is-on" : "toast"} role="status" aria-live="polite" style={centredInRoom(insetEnd, 32)}>
      {shown ? (
        <>
          <Icon className="ic" aria-hidden="true" />
          <span key={shown.key}>{shown.text}</span>
        </>
      ) : null}
    </div>
  );
}
