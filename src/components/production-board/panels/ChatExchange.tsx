import { memo, useCallback, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { AttachmentGallery } from "@/components/AttachmentGallery";
import { FOLDED_SENT_TEXT, foldsSentText } from "@/components/chat-bubble";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { CitationBadge } from "@/components/CitationUI";
import { ThreadRefText } from "@/components/ThreadRefs";
import { atBottom, followBottomGrowth, useBottomFollowResize } from "@/lib/bottom-follow";
import { splitTranscriptCitations } from "@/lib/citations";
import { cn } from "@/lib/cn";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import type { CanvasExchangeMessage } from "@/lib/project-canvas/types";

const BUBBLE = "max-w-[85%] rounded-4xl px-3 py-1.5 text-[13px] leading-[18px]";

export interface ChatExchangeProps {
  /** Null until the first read comes back. */
  messages: readonly CanvasExchangeMessage[] | null;
  botName: string;
  readError: string | null;
  locale: string;
}

/** The bot's latest exchange, kept scrolled to its end while the person reads at the end. */
export const ChatExchange = memo(function ChatExchange({ messages, botName, readError }: ChatExchangeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const follow = useCallback(() => followBottomGrowth(scrollRef.current!, following.current), []);
  useBottomFollowResize(scrollRef, listRef, botName, follow);
  return (
    <div ref={scrollRef} data-board-exchange="" className="min-h-0 flex-1 overflow-y-auto px-4" onScroll={() => (following.current = atBottom(scrollRef.current!))}>
      <div ref={listRef} className="flex flex-col gap-2 py-3">
        {readError ? <p role="alert" className="text-[12px] leading-4 text-danger">{readError}</p> : null}
        {messages === null && !readError ? <LoaderCircle size={16} role="img" aria-label={t("boardPanels.chat.loading")} className="animate-spin self-center text-ink-tertiary motion-reduce:animate-none" /> : null}
        {messages?.length === 0 ? <p className="text-[12px] leading-4 text-ink-tertiary">{t("boardPanels.chat.empty", { name: botName })}</p> : null}
        {messages?.map((message) => message.role === "person" ? (
          <div key={message.id} dir="auto" className={cn(BUBBLE, "self-end bg-bubble-user")}>
            <span className="sr-only">{t("boardPanels.chat.you")}: </span>
            <SentMessage text={message.text} />
          </div>
        ) : (
          <div key={message.id} dir="auto" className={cn(BUBBLE, "self-start bg-ink/[0.06] text-ink")}>
            <span className="sr-only">{botName}: </span>
            <ChatMarkdown text={message.text} />
          </div>
        ))}
      </div>
    </div>
  );
});

/** A person's message as the chat shows it: its pictures and files, then its words, folded when long. */
function SentMessage({ text }: { text: string }) {
  const [unfolded, setUnfolded] = useState(false);
  const cited = splitTranscriptCitations(text);
  const { display, images, files } = splitTranscriptAttachments(cited.display);
  const folds = foldsSentText(display);
  return (
    <>
      <AttachmentGallery images={images} files={files} className={cn("w-56", !display && "mb-0")} />
      {display ? <div className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", folds && !unfolded && FOLDED_SENT_TEXT)}><ThreadRefText text={display} /></div> : null}
      {cited.citations.length ? <div className="mt-2 flex flex-wrap gap-1.5">{cited.citations.map((citation) => <CitationBadge key={citation.id} citation={citation} />)}</div> : null}
      {folds ? (
        <button type="button" className="mt-1 text-[13px] opacity-80 hover:opacity-100" onClick={() => setUnfolded((open) => !open)}>
          {unfolded ? t("chat.showLess") : t("chat.showFull")}
        </button>
      ) : null}
    </>
  );
}
