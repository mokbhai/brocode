// FILE: ChatEmptyStateHero.tsx
// Purpose: Render the centered empty-state hero for blank transcripts.
// Layer: Chat presentation
// Depends on: the caller-supplied project display name.

import { memo } from "react";

const CHAT_MASCOT_SRC = "/brocode-bracket-static.svg";

export function ChatMascotImage({
  className,
  intrinsicSizePx,
}: {
  className: string;
  intrinsicSizePx: number;
}) {
  return (
    <img
      alt="BroCode logo"
      className={className}
      draggable={false}
      height={intrinsicSizePx}
      src={CHAT_MASCOT_SRC}
      width={intrinsicSizePx}
    />
  );
}

export const ChatEmptyStateHero = memo(function ChatEmptyStateHero({
  projectName,
}: {
  projectName: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <ChatMascotImage
        className="size-[84px] object-contain"
        intrinsicSizePx={168}
      />

      <div className="flex flex-col items-center gap-0.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground/90">Let's build</h1>
        {projectName && <span className="text-lg text-muted-foreground/40">{projectName}</span>}
      </div>
    </div>
  );
});
