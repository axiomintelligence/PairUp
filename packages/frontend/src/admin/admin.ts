import * as api from '../api.ts';
import { ApiError } from '../api.ts';
import { clear, el } from '../dom.ts';
import { openModal, closeModal } from '../render/modals.ts';

export async function openAdminModal(): Promise<void> {
  const root = el('div', { class: 'admin-modal-box' });
  root.appendChild(el('div', { class: 'privacy-modal-title' }, 'Admin'));
  root.appendChild(el('div', { class: 'privacy-modal-sub' }, 'Stats, weights, allowlist, audit'));
  root.appendChild(el('div', { class: 'privacy-text' }, 'Loading…'));
  openModal(root);

  try {
    const [stats, weights, allow, audit] = await Promise.all([
      api.admin.stats(),
      api.admin.getWeights(),
      api.admin.listAllowlist(),
      api.admin.audit(20),
    ]);
    clear(root);

    root.appendChild(el('div', { class: 'privacy-modal-title' }, 'Admin'));

    // Stats
    root.appendChild(el('div', { class: 'privacy-section-label' }, 'STATS'));
    root.appendChild(
      el(
        'div',
        { class: 'admin-weight-row' },
        statRow('Users', stats.users),
        statRow('Published profiles', stats.publishedProfiles),
        statRow('Pending requests', stats.pendingRequests),
        statRow('Accepted connections', stats.acceptedConnections),
        statRow('Signups (last 7 days)', stats.signupsLast7Days),
      ),
    );

    // Weights
    root.appendChild(el('div', { class: 'privacy-section-label', style: 'margin-top:14px' }, 'WEIGHTS'));
    const weightsRow = el('div', { class: 'admin-weight-row' });
    let gp = weights.gradePenalty;
    let cap = weights.outboundPendingCap;

    const gpRow = el('div', { class: 'pill-row' });
    for (const opt of ['hard', 'heavy', 'light', 'none'] as const) {
      const btn = el('button', {
        type: 'button',
        class: `chip${gp === opt ? ' selected' : ''}`,
      }, `${opt} grade penalty`);
      btn.addEventListener('click', () => {
        gp = opt;
        for (const c of gpRow.children) (c as HTMLElement).classList.remove('selected');
        btn.classList.add('selected');
      });
      gpRow.appendChild(btn);
    }
    weightsRow.appendChild(el('div', { class: 'admin-weight-label' }, 'Grade penalty'));
    weightsRow.appendChild(gpRow);

    const capInput = el('input', {
      type: 'number',
      class: 'text-input',
      min: '1',
      max: '10000',
      value: String(cap),
    }) as HTMLInputElement;
    capInput.addEventListener('input', () => {
      cap = Math.max(1, Math.min(10000, Number(capInput.value) || 50));
    });
    weightsRow.appendChild(el('div', { class: 'admin-weight-label' }, 'Outbound pending cap'));
    weightsRow.appendChild(capInput);

    const saveWeights = el('button', { type: 'button', class: 'admin-save-btn' }, 'Save weights');
    saveWeights.addEventListener('click', async () => {
      try {
        await api.admin.putWeights({ gradePenalty: gp, outboundPendingCap: cap });
        flash(saveWeights, 'Saved.');
      } catch (err) {
        flash(saveWeights, err instanceof ApiError ? err.message : 'Failed', true);
      }
    });
    weightsRow.appendChild(saveWeights);
    root.appendChild(weightsRow);

    // Allowlist
    root.appendChild(el('div', { class: 'privacy-section-label', style: 'margin-top:14px' }, 'ALLOWLIST'));
    const bulkArea = el('textarea', { class: 'text-input', rows: '4', placeholder: 'one email per line' }) as HTMLTextAreaElement;
    root.appendChild(bulkArea);
    const bulkActions = el('div', { class: 'form-actions' });
    const bulkAddBtn = el('button', { type: 'button', class: 'btn-primary-sm' }, 'Bulk add');
    const bulkRemoveBtn = el('button', { type: 'button', class: 'btn-danger-soft' }, 'Bulk remove');
    const csvBtn = el('a', { class: 'btn-ghost-small', href: '/api/admin/allowlist.csv', target: '_blank' }, 'Download CSV');
    bulkActions.appendChild(bulkAddBtn);
    bulkActions.appendChild(bulkRemoveBtn);
    bulkActions.appendChild(csvBtn);
    root.appendChild(bulkActions);

    const allowResult = el('div', { class: 'privacy-text', style: 'margin-top:8px' });
    root.appendChild(allowResult);

    bulkAddBtn.addEventListener('click', async () => {
      const emails = bulkArea.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      if (emails.length === 0) return;
      const res = await api.admin.bulkAdd(emails);
      allowResult.textContent = `added: ${res.added}, already-present: ${res.alreadyPresent}, rejected: ${res.rejected.length}`;
    });
    bulkRemoveBtn.addEventListener('click', async () => {
      const emails = bulkArea.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      if (emails.length === 0) return;
      const res = await api.admin.bulkRemove(emails);
      allowResult.textContent = `removed: ${res.removed}, not-present: ${res.notPresent}`;
    });

    const list = el('div', { style: 'margin-top:10px;font-size:12px;color:#555' });
    if (allow.entries.length === 0) {
      list.textContent = '(allowlist is empty)';
    } else {
      list.appendChild(el('div', { style: 'font-weight:600' }, `${allow.entries.length} entries`));
      const ul = el('ul', { style: 'margin:6px 0 0 16px' });
      for (const e of allow.entries.slice(0, 10)) {
        ul.appendChild(el('li', {}, `${e.email} (${new Date(e.addedAt).toLocaleDateString()})`));
      }
      list.appendChild(ul);
    }
    root.appendChild(list);

    // Audit
    root.appendChild(el('div', { class: 'privacy-section-label', style: 'margin-top:14px' }, 'RECENT AUDIT'));
    const auditUl = el('ul', { style: 'font-size:12px;color:#555;margin:6px 0 0 16px' });
    for (const a of audit.entries.slice(0, 10)) {
      auditUl.appendChild(
        el(
          'li',
          {},
          `${new Date(a.at).toLocaleString()} — ${a.action}${a.target ? ` → ${a.target}` : ''}`,
        ),
      );
    }
    root.appendChild(auditUl);

    const closeBtn = el('button', { type: 'button', class: 'btn-ghost-small', style: 'margin-top:12px' }, 'Close');
    closeBtn.addEventListener('click', closeModal);
    root.appendChild(closeBtn);
  } catch (err) {
    clear(root);
    root.appendChild(el('div', {}, err instanceof ApiError ? err.message : 'Failed to load admin data'));
  }
}

function statRow(label: string, value: number): HTMLElement {
  return el(
    'div',
    { class: 'admin-weight-header' },
    el('div', { class: 'admin-weight-label' }, label),
    el('div', { class: 'admin-weight-val' }, String(value)),
  );
}

function flash(target: HTMLElement, message: string, isError = false): void {
  const previousText = target.textContent;
  target.textContent = message;
  target.classList.add(isError ? 'error' : 'ok');
  setTimeout(() => {
    target.textContent = previousText;
    target.classList.remove('error', 'ok');
  }, 1800);
}
