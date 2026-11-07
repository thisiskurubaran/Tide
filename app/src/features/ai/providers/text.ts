// Text clean-up shared by the providers: reasoning that some models write
// inline in <think> tags, and the extras chat models add to completions.

const THINK = /<(think|thinking|reasoning)>[\s\S]*?(<\/\1>|$)/gi;

// Removes inline reasoning (DeepSeek, Qwen and others write it into the
// answer in <think> tags, sometimes without closing them).
export function stripThinking(text: string): string {
  return text.replace(THINK, '').replace(/^\s*<\/(think|thinking|reasoning)>/i, '');
}

// The same for text arriving in pieces: holds back what might be the start
// of a tag, and drops everything inside one.
export function thinkingFilter(emit: (text: string) => void) {
  let inside = false;
  let pending = '';
  return {
    push(delta: string) {
      pending += delta;
      for (;;) {
        if (inside) {
          const end = pending.search(/<\/(think|thinking|reasoning)>/i);
          if (end < 0) {
            // Keep a tail that may be the start of the closing tag.
            pending = pending.slice(-12);
            return;
          }
          pending = pending.slice(end).replace(/^<\/(think|thinking|reasoning)>/i, '');
          inside = false;
          continue;
        }
        const start = pending.search(/<(think|thinking|reasoning)>/i);
        if (start >= 0) {
          if (start > 0) emit(pending.slice(0, start));
          pending = pending.slice(start).replace(/^<(think|thinking|reasoning)>/i, '');
          inside = true;
          continue;
        }
        // Hold back a partial "<thi" at the end.
        const lt = pending.lastIndexOf('<');
        const hold = lt >= 0 && pending.length - lt < 12 && /^<\/?[a-z]*$/i.test(pending.slice(lt)) ? pending.slice(lt) : '';
        const out = pending.slice(0, pending.length - hold.length);
        if (out) emit(out);
        pending = hold;
        return;
      }
    },
    flush() {
      if (!inside && pending) emit(pending);
      pending = '';
    },
  };
}

// What a completion model said, as the text to insert at the cursor: no
// fences, no reasoning, and none of the code around the cursor repeated.
export function cleanCompletion(text: string, prefix: string, suffix: string): string {
  let t = stripThinking(text).replace(/<\/?CURSOR\/?>/g, '');
  const fenced = t.match(/```[^\n`]*\n([\s\S]*?)(\n?```|$)/);
  if (fenced) t = fenced[1];
  // A repeated current line ("  const x = " again before the rest).
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (line.trim() && t.startsWith(line)) t = t.slice(line.length);
  else if (line.trim().length >= 4 && t.trimStart().startsWith(line.trim())) t = t.trimStart().slice(line.trim().length);
  // Code that's already after the cursor.
  const head = suffix.slice(0, 200);
  for (let k = Math.min(head.length, t.length); k >= 3; k--) {
    if (head.slice(0, k).trim() && t.endsWith(head.slice(0, k))) {
      t = t.slice(0, t.length - k);
      break;
    }
  }
  if (!suffix || suffix.startsWith('\n')) t = t.replace(/\s+$/, '');
  return t.trim() ? t : '';
}

// Cuts long text to its last `max` characters, at a line start when one is near.
export function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut;
}

// Cuts long text to its first `max` characters, at a line end when one is near.
export function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  return nl >= 0 && max - nl < 200 ? cut.slice(0, nl) : cut;
}
