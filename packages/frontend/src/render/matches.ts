import * as api from '../api.ts';
import { ApiError } from '../api.ts';
import { clear, el, show } from '../dom.ts';
import { state } from '../state.ts';
import type { MatchEntry } from '../types.ts';

let host: HTMLElement | null = null;

export async function renderMatches(into: HTMLElement): Promise<void> {
  host = into;
  clear(host);
  host.appendChild(el('div', { class: 'tab-inner' }, el('div', {}, 'Loading matches…')));

  try {
    const [m, reqs] = await Promise.all([api.matches.list(), api.requests.list()]);
    state.matches = m.matches;
    state.outbound = reqs.outbound;
    state.inbound = reqs.inbound;
    rerender();
  } catch (err) {
    clear(host);
    host.appendChild(buildError(err));
  }
}

function buildError(err: unknown): HTMLElement {
  const message =
    err instanceof ApiError
      ? err.code === 'not_found'
        ? 'Publish your profile to see matches.'
        : err.message
      : 'Failed to load matches.';
  return el(
    'div',
    { class: 'tab-inner' },
    el(
      'div',
      { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🔍'),
      el('div', { class: 'empty-title' }, 'No matches yet'),
      el('div', { class: 'empty-sub' }, message),
    ),
  );
}

function rerender(): void {
  if (!host) return;
  clear(host);
  const root = el('div', { class: 'tab-inner' });

  if (state.matches.length === 0) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '🌱'),
        el('div', { class: 'empty-title' }, 'No matches yet'),
        el(
          'div',
          { class: 'empty-sub' },
          "We don't have many published profiles yet. Make sure yours is published, and invite colleagues.",
        ),
      ),
    );
    host.appendChild(root);
    return;
  }

  root.appendChild(el('div', { class: 'page-intro' }, el('h1', {}, 'Your matches')));

  const cards = el('div', { class: 'cards-grid' });
  for (const m of state.matches) {
    cards.appendChild(buildCard(m));
  }
  root.appendChild(cards);
  host.appendChild(root);
}

function buildCard(m: MatchEntry): HTMLElement {
  const outbound = state.outbound.find((r) => r.toUserId === m.userId);

  const card = el('div', { class: 'ccard' }, el('div', { class: 'ccard-accent' }));
  const inner = el('div', { class: 'ccard-inner' });
  const left = el('div', { class: 'ccard-left' });

  left.appendChild(
    el(
      'div',
      { class: 'ccard-name-row' },
      el('div', { class: 'ccard-name' }, m.displayName),
      el('div', { class: 'cmatch' }, `${m.score}% match`),
    ),
  );

  const tags = el('div', { class: 'ccard-tags' });
  tags.appendChild(el('span', { class: 'ctag ctag-grey' }, m.grade));
  for (const d of m.directorates.slice(0, 2)) {
    tags.appendChild(el('span', { class: 'ctag ctag-green' }, d));
  }
  tags.appendChild(el('span', { class: 'ctag ctag-grey' }, m.location));
  left.appendChild(tags);

  // Day pattern abbreviation
  const days = m.days as Record<string, string>;
  const dayChips = ['Mo', 'Tu', 'We', 'Th', 'Fr']
    .map((d, i) => {
      const v = days[['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i]!];
      const sym = v === 'full' ? '●' : v === 'part' ? '◐' : v === 'flexible' ? '✱' : '○';
      return `${d}${sym}`;
    })
    .join(' ');
  left.appendChild(el('div', { class: 'ccard-pattern-row' }, el('span', { class: 'cdays' }, dayChips)));

  if (m.availability) {
    left.appendChild(el('div', { class: 'ccard-availability' }, m.availability));
  }

  inner.appendChild(left);

  // Right column — actions
  const right = el('div', { class: 'ccard-right' });
  if (outbound && outbound.status === 'pending') {
    const withdrawBtn = el('button', { type: 'button', class: 'btn-ghost-small' }, 'Withdraw');
    withdrawBtn.addEventListener('click', () => void onWithdraw(outbound.id));
    right.appendChild(el('span', { class: 'cstatus-pending' }, 'Pending'));
    right.appendChild(withdrawBtn);
  } else if (outbound && outbound.status === 'accepted') {
    right.appendChild(el('span', { class: 'cstatus-pending' }, 'Connected'));
  } else {
    const sendBtn = el('button', { type: 'button', class: 'btn-primary-sm' }, 'Request');
    sendBtn.addEventListener('click', () => void onRequest(m));
    right.appendChild(sendBtn);
    const dismissBtn = el('button', { type: 'button', class: 'btn-ghost-small' }, 'Dismiss');
    dismissBtn.addEventListener('click', () => void onDismiss(m));
    right.appendChild(dismissBtn);
  }
  inner.appendChild(right);
  card.appendChild(inner);
  return card;
}

async function onRequest(m: MatchEntry): Promise<void> {
  try {
    const req = await api.requests.create(m.userId);
    state.outbound = [...state.outbound.filter((r) => r.id !== req.id), req];
    rerender();
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
    else throw err;
  }
}

async function onWithdraw(id: string): Promise<void> {
  await api.requests.withdraw(id);
  state.outbound = state.outbound.map((r) => (r.id === id ? { ...r, status: 'withdrawn' } : r));
  rerender();
}

async function onDismiss(m: MatchEntry): Promise<void> {
  await api.matches.dismiss(m.userId);
  state.matches = state.matches.filter((x) => x.userId !== m.userId);
  rerender();
}
