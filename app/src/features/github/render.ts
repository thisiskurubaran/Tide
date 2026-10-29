// GitHub conversations and diffs as HTML for one web view, so long threads
// stay cheap: Markdown bodies, reviews, comments, and changed files.
import { escapeHtml, markdownToHtml } from '../preview/render';
import type { Comment, Issue, Pull, PullFile, Review } from './api';
import { timeAgo } from './api';

const REVIEW_LABEL: Record<Review['state'], string> = {
  APPROVED: 'approved these changes',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'reviewed',
  DISMISSED: 'had a review dismissed',
  PENDING: 'started a review',
};

interface Entry {
  at: string;
  html: string;
}

const entry = (login: string, action: string, at: string, body: string | null, kind = '') =>
  `<section class="gh-item ${kind}"><p class="gh-meta"><b>${escapeHtml(login)}</b> ${action} · ${timeAgo(at)}</p>${
    body?.trim() ? `<div class="gh-body">${markdownToHtml(body)}</div>` : ''
  }</section>`;

export function conversationHtml(head: Issue | Pull, comments: Comment[], reviews: Review[] = []): string {
  const items: Entry[] = [
    ...comments.map((c) => ({ at: c.created_at, html: entry(c.user.login, 'commented', c.created_at, c.body) })),
    ...reviews
      .filter((r) => r.submitted_at && (r.state !== 'COMMENTED' || r.body?.trim()))
      .map((r) => ({ at: r.submitted_at!, html: entry(r.user.login, REVIEW_LABEL[r.state], r.submitted_at!, r.body, `review-${r.state.toLowerCase()}`) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const opening = entry(head.user.login, 'opened this', head.created_at, head.body || '_No description._', 'opening');
  return `${GH_STYLE}${opening}${items.map((i) => i.html).join('')}`;
}

const STATUS_LABEL: Record<string, string> = { added: 'Added', removed: 'Deleted', renamed: 'Renamed', modified: 'Modified', changed: 'Changed', copied: 'Copied', unchanged: 'Unchanged' };

export function filesHtml(files: PullFile[]): string {
  if (!files.length) return '<p class="note">No changed files.</p>';
  return `${GH_STYLE}${files
    .map((f) => {
      const lines = (f.patch ?? '')
        .split('\n')
        .map((l) => {
          const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
          return `<div class="${cls}">${escapeHtml(l) || ' '}</div>`;
        })
        .join('');
      const body = f.patch ? `<div class="diff">${lines}</div>` : '<p class="note">No text diff (binary or too large).</p>';
      return `<details open class="gh-file"><summary><span class="fname">${escapeHtml(f.filename)}</span> <span class="note">${STATUS_LABEL[f.status] ?? f.status} · <span class="plus">+${f.additions}</span> <span class="minus">−${f.deletions}</span></span></summary>${body}</details>`;
    })
    .join('')}`;
}

const GH_STYLE = `<style>
.gh-item{border:1px solid var(--b,rgba(127,127,127,.3));border-radius:10px;padding:0 12px;margin:0 0 12px}
.gh-meta{font-size:.85em;opacity:.8;margin:10px 0}
.gh-body>:first-child{margin-top:0}
.review-approved{border-color:#3fc095}
.review-changes_requested{border-color:#f2776d}
.gh-file{margin:0 0 12px;border:1px solid rgba(127,127,127,.3);border-radius:8px;overflow:hidden}
.gh-file summary{padding:8px 10px;font-size:.9em;cursor:pointer}
.fname{font-family:ui-monospace,Menlo,monospace;word-break:break-all}
.diff{font:12px/1.5 ui-monospace,Menlo,monospace;overflow-x:auto;white-space:pre}
.diff div{padding:0 10px;min-width:max-content}
.add{background:rgba(63,192,149,.18)}
.del{background:rgba(242,119,109,.18)}
.hunk{opacity:.6;background:rgba(127,127,127,.12)}
.plus{color:#3fc095}.minus{color:#f2776d}
</style>`;
