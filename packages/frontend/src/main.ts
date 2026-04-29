// PairUp frontend bootstrap.
// Vanilla TypeScript per HLD §17. Compiled by esbuild → apps/web/public/app.js.

import * as api from './api.ts';
import { ApiError } from './api.ts';
import { $, clear, show } from './dom.ts';
import { setActiveTab, state, type Tab } from './state.ts';
import { renderProfile } from './render/profile.ts';
import { renderMatches } from './render/matches.ts';
import { renderConnections } from './render/connections.ts';
import { closeModal, openAboutModal, openPrivacyModal } from './render/modals.ts';

async function bootstrap(): Promise<void> {
  // Modal close-on-background-click.
  $('modalOverlay').addEventListener('click', (e) => {
    if (e.target === $('modalOverlay')) closeModal();
  });

  // Header buttons.
  $('privacyBtn').addEventListener('click', openPrivacyModal);
  $('aboutBtn').addEventListener('click', openAboutModal);
  $('signOutBtn').addEventListener('click', () => void signOut());
  $('adminBtn').addEventListener('click', () => void openAdmin());

  // Tab nav.
  $('navTabs').addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.nav-tab') as HTMLElement | null;
    if (!target) return;
    const tab = (target.dataset.tab ?? 'profile') as Tab;
    setActiveTab(tab);
    void switchTab(tab);
  });

  await refreshAuth();
}

async function refreshAuth(): Promise<void> {
  try {
    const me = await api.auth.me();
    state.user = me.user;
    showSignedIn(me.authenticated);
    if (me.authenticated) {
      await switchTab(state.activeTab);
    }
  } catch (err) {
    showSignedIn(false);
    if (err instanceof ApiError && err.status === 401) return;
    console.error('auth.me failed', err);
  }
}

function showSignedIn(yes: boolean): void {
  show($('signInView'), !yes);
  show($('navTabs'), yes);
  show($('signOutBtn'), yes);
  show($('adminBtn'), yes && !!state.user?.isAdmin);
  show($('tab-profile'), false);
  show($('tab-matches'), false);
  show($('tab-connections'), false);
}

async function switchTab(tab: Tab): Promise<void> {
  // Highlight active tab pill.
  for (const node of $('navTabs').querySelectorAll('.nav-tab')) {
    (node as HTMLElement).classList.toggle('active', (node as HTMLElement).dataset.tab === tab);
  }

  show($('tab-profile'), tab === 'profile');
  show($('tab-matches'), tab === 'matches');
  show($('tab-connections'), tab === 'connections');

  const host = $(`tab-${tab}`);
  clear(host);
  try {
    if (tab === 'profile') await renderProfile(host);
    else if (tab === 'matches') await renderMatches(host);
    else if (tab === 'connections') await renderConnections(host);
  } catch (err) {
    console.error('render failed', err);
    if (err instanceof ApiError && err.status === 401) {
      // Session expired mid-flow.
      location.assign('/api/auth/login');
    }
  }
}

async function signOut(): Promise<void> {
  try {
    await api.auth.signOut();
  } catch {
    /* ignore */
  }
  location.assign('/');
}

async function openAdmin(): Promise<void> {
  // Lazy-load admin bundle so it's only fetched when isAdmin.
  const { openAdminModal } = await import('./admin/admin.ts');
  await openAdminModal();
}

document.addEventListener('DOMContentLoaded', () => {
  void bootstrap();
});
