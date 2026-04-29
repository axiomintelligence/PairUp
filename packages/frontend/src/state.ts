// UI-only client cache (HLD §11 frontend modularisation: "client cache; server
// is the source of truth"). We keep the last fetched session/profile/matches
// here so render functions can re-render without refetching for trivial
// re-renders. Anything authoritative MUST come from the API.

import type {
  Connection,
  ConnectionRequest,
  MatchEntry,
  ProfileResponse,
  SearchPrefs,
  SessionUser,
} from './types.ts';

export type Tab = 'profile' | 'matches' | 'connections';

export interface ClientState {
  user: SessionUser | null;
  profile: ProfileResponse | null;
  prefs: SearchPrefs | null;
  matches: MatchEntry[];
  inbound: ConnectionRequest[];
  outbound: ConnectionRequest[];
  connections: Connection[];
  activeTab: Tab;
}

const LAST_TAB_KEY = 'pairup_ui_last_tab';

export const state: ClientState = {
  user: null,
  profile: null,
  prefs: null,
  matches: [],
  inbound: [],
  outbound: [],
  connections: [],
  activeTab: (localStorage.getItem(LAST_TAB_KEY) as Tab | null) ?? 'profile',
};

export function setActiveTab(tab: Tab): void {
  state.activeTab = tab;
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    /* private mode — ignore */
  }
}
