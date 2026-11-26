import { useContext } from "react";
import { ExternalLink } from "lucide-react";
import type { CanvasBotState } from "../../../../shared/project-canvas";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "@/components/PendingApproval";
import { approvalDetailText } from "@/lib/approval-summary";
import { t } from "@/lib/i18n";
import { isQuestionCard } from "@/lib/question-card";
import { StoreContext, type Message } from "@/state/store";

type Waiting = NonNullable<CanvasBotState["waiting"]>;

/** What the bot waits on the person for, worded as the chat words it. An approval is answered here with the chat's own
 * actions where the page has the app's store to send them; anything else is answered in the conversation. */
export function ChatWaiting({ bot, waiting, onOpenChat }: { bot: Pick<CanvasBotState, "botId" | "name">; waiting: Waiting; onOpenChat: () => void }) {
  const store = useContext(StoreContext);
  const { threadId, messageId, card } = waiting;
  const approval = pendingApprovals([{ id: messageId, role: "bot", kind: "options", text: "", at: 0, card } as Message])[0];
  const answerInChat = (
    <button type="button" className="ui-button ui-button-sm" onClick={onOpenChat}>
      <ExternalLink size={14} aria-hidden="true" />
      {t("boardPanels.chat.answerInChat")}
    </button>
  );
  if (approval) {
    return (
      <div className="bc-wait">
        <PendingApprovalPanel
          pending={approval}
          count={1}
          index={0}
          botName={bot.name}
          actions={store
            ? <PendingApprovalActions part="primary" tag="canvas" pending={approval} threadId={threadId} bot={store.state.bots.find((one) => one.id === bot.botId)} onCancelTurn={() => {}} />
            : answerInChat}
        />
      </div>
    );
  }
  const detail = approvalDetailText(card);
  return (
    <div className="bc-wait" role="status">
      <b>{isQuestionCard(card) ? t("question.card.named", { name: bot.name }) : card.title}</b>
      {detail ? <p>{detail}</p> : null}
      {answerInChat}
    </div>
  );
}
