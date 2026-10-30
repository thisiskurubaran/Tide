// GitHub conversations as HTML for one web view, so long threads stay cheap:
// Markdown bodies, reviews and comments.
import { escapeHtml, markdownToHtml } from '../preview/render';
import type { Comment, Issue, Pull, Review } from './api';
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

const GH_STYLE = `<style>
.gh-item{border:1px solid var(--b,rgba(127,127,127,.3));border-radius:10px;padding:0 12px;margin:0 0 12px}
.gh-meta{font-size:.85em;opacity:.8;margin:10px 0}
.gh-body>:first-child{margin-top:0}
.review-approved{border-color:#3fc095}
.review-changes_requested{border-color:#f2776d}
</style>`;
