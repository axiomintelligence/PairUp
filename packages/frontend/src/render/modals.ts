import { $, clear, el } from '../dom.ts';

export function openModal(content: HTMLElement): void {
  const overlay = $('modalOverlay');
  const box = $('modalBox');
  clear(box);
  const close = el('button', { type: 'button', class: 'modal-close' }, '×');
  close.addEventListener('click', closeModal);
  box.appendChild(close);
  box.appendChild(content);
  overlay.removeAttribute('hidden');
  overlay.classList.add('open');
}

export function closeModal(): void {
  const overlay = $('modalOverlay');
  overlay.setAttribute('hidden', '');
  overlay.classList.remove('open');
}

export function openPrivacyModal(): void {
  openModal(
    el(
      'div',
      { class: 'privacy-modal-box' },
      el(
        'div',
        { class: 'privacy-modal-header' },
        el('div', {}, el('div', { class: 'privacy-modal-title' }, 'Privacy & data'),
          el('div', { class: 'privacy-modal-sub' }, 'How PairUp handles your information')),
      ),
      el(
        'div',
        { class: 'privacy-section' },
        el('div', { class: 'privacy-section-label' }, 'WHAT WE STORE'),
        el(
          'div',
          { class: 'privacy-text' },
          "Your FCDO email and display name (from sign-in), your profile content, who you've connected with, and an audit log of state-changing actions.",
        ),
      ),
      el(
        'div',
        { class: 'privacy-section' },
        el('div', { class: 'privacy-section-label' }, 'WHO CAN SEE IT'),
        el(
          'div',
          { class: 'privacy-text' },
          "Only signed-in FCDO colleagues. Your profile is hidden until you click Publish.",
        ),
      ),
      el(
        'div',
        { class: 'privacy-section' },
        el('div', { class: 'privacy-section-label' }, 'YOUR RIGHTS'),
        el(
          'div',
          { class: 'privacy-text' },
          'Use the buttons on the My Profile tab to export everything as JSON, or to permanently delete your account and all associated data.',
        ),
      ),
      el(
        'div',
        { class: 'privacy-footer' },
        'Service controller: FCDO. Operator: AXIOM Intelligence Ltd. UK data residency. ' +
          'Service lifespan ~6 months from launch.',
      ),
    ),
  );
}

export function openAboutModal(): void {
  openModal(
    el(
      'div',
      { class: 'privacy-modal-box' },
      el(
        'div',
        { class: 'privacy-modal-header' },
        el('div', {}, el('div', { class: 'privacy-modal-title' }, 'About PairUp')),
      ),
      el(
        'div',
        { class: 'privacy-text' },
        'PairUp helps FCDO staff find compatible job-share partners by matching on grade, directorate, location, and complementary day patterns. Your profile only appears once you publish, and you control the gates other people must satisfy.',
      ),
    ),
  );
}
