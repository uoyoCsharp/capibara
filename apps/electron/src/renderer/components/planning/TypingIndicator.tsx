/**
 * Animated 3-dot typing indicator (pulse animation).
 * Used in the Planning Chat to show the AI is processing.
 */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted">
      <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
      <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
      <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}
