import { useCallback, useState } from 'react';

export type ToastTone = 'info' | 'refusal';

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
}

/**
 * The toast region.
 *
 * `role="status"` with `aria-live="polite"`, so a refusal reaches a screen
 * reader. The artifact's `#toast` is where a command's `{ok: false, msg}` is
 * announced (ADR-018 rule 1), and a refusal a sighted user sees and a
 * non-sighted user does not is a refusal that did not happen.
 *
 * Polite and not assertive on purpose: these interrupt at the next pause rather
 * than cutting across what is being read. A command refusal is not an
 * emergency.
 */
export function ToastRegion({ messages }: { readonly messages: readonly ToastMessage[] }): React.JSX.Element {
  return (
    <div id="toast" className="toast-region" role="status" aria-live="polite" aria-atomic="false">
      {messages.map((m) => (
        <p key={m.id} className={`toast toast-${m.tone}`}>
          {m.text}
        </p>
      ))}
    </div>
  );
}

/** Minimal queue. Replaced by the command bus in S2; this is the seam. */
export function useToasts(): {
  messages: readonly ToastMessage[];
  push: (text: string, tone?: ToastTone) => void;
} {
  const [messages, setMessages] = useState<readonly ToastMessage[]>([]);
  const push = useCallback((text: string, tone: ToastTone = 'info') => {
    setMessages((current) => [...current, { id: current.length, text, tone }]);
  }, []);
  return { messages, push };
}
