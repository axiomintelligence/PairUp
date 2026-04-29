import * as api from '../api.ts';
import { ApiError } from '../api.ts';
import { clear, el } from '../dom.ts';
import { state } from '../state.ts';
import type { ConnectionRequest } from '../types.ts';

let host: HTMLElement | null = null;

export async function renderConnections(into: HTMLElement): Promise<void> {
  host = into;
  clear(host);
  host.appendChild(el('div', { class: 'tab-inner' }, el('div', {}, 'Loading…')));

  const [reqs, conns] = await Promise.all([api.requests.list(), api.connections.list()]);
  state.inbound = reqs.inbound;
  state.outbound = reqs.outbound;
  state.connections = conns.connections;
  rerender();
}

function rerender(): void {
  if (!host) return;
  clear(host);
  const root = el('div', { class: 'tab-inner' });

  // Inbound (pending only)
  const pendingIn = state.inbound.filter((r) => r.status === 'pending');
  if (pendingIn.length > 0) {
    root.appendChild(el('div', { class: 'page-intro' }, el('h1', {}, 'Requests for you')));
    const grid = el('div', { class: 'cards-grid' });
    for (const r of pendingIn) grid.appendChild(buildInboundCard(r));
    root.appendChild(grid);
  }

  // Connections
  root.appendChild(el('div', { class: 'page-intro' }, el('h1', {}, 'Your connections')));
  if (state.connections.length === 0) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '🤝'),
        el('div', { class: 'empty-title' }, 'No connections yet'),
        el('div', { class: 'empty-sub' }, 'Send or accept a request to start a conversation.'),
      ),
    );
  } else {
    const grid = el('div', { class: 'cards-grid' });
    for (const c of state.connections) {
      grid.appendChild(
        el(
          'div',
          { class: 'ccard' },
          el('div', { class: 'ccard-accent' }),
          el(
            'div',
            { class: 'ccard-inner' },
            el(
              'div',
              { class: 'ccard-left' },
              el('div', { class: 'ccard-name-row' }, el('div', { class: 'ccard-name' }, c.otherDisplayName)),
              el(
                'div',
                { class: 'ccard-availability' },
                `Connected ${new Date(c.createdAt).toLocaleDateString()}`,
              ),
            ),
          ),
        ),
      );
    }
    root.appendChild(grid);
  }

  // Outbound pending
  const pendingOut = state.outbound.filter((r) => r.status === 'pending');
  if (pendingOut.length > 0) {
    root.appendChild(el('div', { class: 'page-intro' }, el('h1', {}, 'Awaiting response')));
    const grid = el('div', { class: 'cards-grid' });
    for (const r of pendingOut) grid.appendChild(buildOutboundCard(r));
    root.appendChild(grid);
  }

  host.appendChild(root);
}

function buildInboundCard(r: ConnectionRequest): HTMLElement {
  const card = el('div', { class: 'ccard' }, el('div', { class: 'ccard-accent' }));
  const inner = el('div', { class: 'ccard-inner' });
  inner.appendChild(
    el(
      'div',
      { class: 'ccard-left' },
      el(
        'div',
        { class: 'ccard-name-row' },
        el('div', { class: 'ccard-name' }, `Colleague: ${r.fromUserId.slice(0, 8)}…`),
        el('div', { class: 'cstatus-inbound' }, 'Wants to connect'),
      ),
      el(
        'div',
        { class: 'ccard-availability' },
        `Sent ${new Date(r.createdAt).toLocaleDateString()}`,
      ),
    ),
  );
  const right = el('div', { class: 'ccard-right' });
  const accept = el('button', { type: 'button', class: 'btn-primary-sm' }, 'Accept');
  accept.addEventListener('click', () => void doAccept(r.id));
  const decline = el('button', { type: 'button', class: 'btn-ghost-small' }, 'Decline');
  decline.addEventListener('click', () => void doDecline(r.id));
  right.appendChild(accept);
  right.appendChild(decline);
  inner.appendChild(right);
  card.appendChild(inner);
  return card;
}

function buildOutboundCard(r: ConnectionRequest): HTMLElement {
  const card = el('div', { class: 'ccard' }, el('div', { class: 'ccard-accent' }));
  const inner = el('div', { class: 'ccard-inner' });
  inner.appendChild(
    el(
      'div',
      { class: 'ccard-left' },
      el(
        'div',
        { class: 'ccard-name-row' },
        el('div', { class: 'ccard-name' }, `Sent to ${r.toUserId.slice(0, 8)}…`),
        el('div', { class: 'cstatus-pending' }, 'Awaiting'),
      ),
      el(
        'div',
        { class: 'ccard-availability' },
        `Sent ${new Date(r.createdAt).toLocaleDateString()}`,
      ),
    ),
  );
  const right = el('div', { class: 'ccard-right' });
  const withdraw = el('button', { type: 'button', class: 'btn-ghost-small' }, 'Withdraw');
  withdraw.addEventListener('click', () => void doWithdraw(r.id));
  right.appendChild(withdraw);
  inner.appendChild(right);
  card.appendChild(inner);
  return card;
}

async function doAccept(id: string): Promise<void> {
  try {
    await api.requests.accept(id);
    await refreshAll();
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
  }
}
async function doDecline(id: string): Promise<void> {
  await api.requests.decline(id);
  await refreshAll();
}
async function doWithdraw(id: string): Promise<void> {
  await api.requests.withdraw(id);
  await refreshAll();
}

async function refreshAll(): Promise<void> {
  const [reqs, conns] = await Promise.all([api.requests.list(), api.connections.list()]);
  state.inbound = reqs.inbound;
  state.outbound = reqs.outbound;
  state.connections = conns.connections;
  rerender();
}
