import * as api from '../api.ts';
import { ApiError } from '../api.ts';
import { $, clear, el } from '../dom.ts';
import { state } from '../state.ts';
import {
  DAYS_OF_WEEK,
  FCDO_DIRECTORATES,
  GRADES,
  LOCATIONS,
  type DayKey,
  type DayMode,
  type Days,
  type Grade,
  type ProfileBody,
  type ProfileResponse,
  type Visibility,
  type VisibilityMode,
} from '../types.ts';

// Editable form state — held outside `state` because it includes draft
// changes the user hasn't saved yet.
let draft: ProfileBody = emptyProfile();
let saveStatus: HTMLElement | null = null;

function emptyProfile(): ProfileBody {
  return {
    grade: 'G7',
    directorates: [],
    location: '',
    overseasPost: null,
    fte: null,
    daysNegotiable: null,
    availability: null,
    skills: null,
    workingPatternNotes: null,
    otherInfo: null,
    style: null,
    days: { Mon: 'non', Tue: 'non', Wed: 'non', Thu: 'non', Fri: 'non' },
    visibility: { grade: 'must', directorates: 'must', location: 'open', days: 'open' },
  };
}

function fromResponse(p: ProfileResponse): ProfileBody {
  return {
    grade: p.grade,
    directorates: p.directorates,
    location: p.location,
    overseasPost: p.overseasPost ?? null,
    fte: p.fte ?? null,
    daysNegotiable: p.daysNegotiable ?? null,
    availability: p.availability ?? null,
    skills: p.skills ?? null,
    workingPatternNotes: p.workingPatternNotes ?? null,
    otherInfo: p.otherInfo ?? null,
    style: p.style ?? null,
    days: p.days,
    visibility: p.visibility,
  };
}

function setStatus(message: string, kind: 'ok' | 'error' | ''): void {
  if (!saveStatus) return;
  saveStatus.textContent = message;
  saveStatus.className = `save-status${kind ? ` ${kind}` : ''}`;
  saveStatus.style.display = message ? 'block' : 'none';
}

function pillButton(label: string, selected: boolean, onClick: () => void, cls = 'chip'): HTMLElement {
  const btn = el('button', {
    type: 'button',
    class: `${cls}${selected ? ' selected' : ''}`,
  }, label);
  btn.addEventListener('click', onClick);
  return btn;
}

function dayPicker(): HTMLElement {
  const grid = el('div', { class: 'days-grid' });
  for (const day of DAYS_OF_WEEK) {
    const row = el('div', { class: 'day-row' }, el('div', { class: 'day-label' }, day.toUpperCase()));
    for (const mode of ['full', 'part', 'non', 'flexible'] as const) {
      const btn = el('button', {
        type: 'button',
        class: `day-opt${draft.days[day] === mode ? ' selected' : ''}`,
        'data-val': mode,
      }, mode === 'flexible' ? 'Flex' : mode[0]!.toUpperCase() + mode.slice(1));
      btn.addEventListener('click', () => {
        draft.days = { ...draft.days, [day]: mode };
        rerender();
      });
      row.appendChild(btn);
    }
    grid.appendChild(row);
  }
  return grid;
}

function visibilityPicker(label: string, key: keyof Visibility, descMust: string, descOpen: string): HTMLElement {
  const row = el('div', { class: 'visibility-row' }, el('div', { class: 'visibility-label' }, label));
  const toggles = el('div', { class: 'toggle-row' });
  for (const opt of ['must', 'open'] as const) {
    const btn = el('button', {
      type: 'button',
      class: `toggle-btn${draft.visibility[key] === opt ? ' selected' : ''}`,
      'data-val': opt,
    }, opt === 'must' ? `Must · ${descMust}` : `Open · ${descOpen}`);
    btn.addEventListener('click', () => {
      draft.visibility = { ...draft.visibility, [key]: opt as VisibilityMode };
      rerender();
    });
    toggles.appendChild(btn);
  }
  row.appendChild(toggles);
  return row;
}

function textInput(label: string, value: string | null, onInput: (v: string) => void, max = 120): HTMLElement {
  const wrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, label));
  const input = el('input', {
    type: 'text',
    class: 'text-input',
    value: value ?? '',
    maxlength: String(max),
  }) as HTMLInputElement;
  input.value = value ?? '';
  input.addEventListener('input', () => onInput(input.value));
  wrap.appendChild(input);
  return wrap;
}

function textareaInput(label: string, value: string | null, onInput: (v: string) => void, max = 2000): HTMLElement {
  const wrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, label));
  const ta = el('textarea', {
    class: 'text-input',
    rows: '3',
    maxlength: String(max),
  }) as HTMLTextAreaElement;
  ta.value = value ?? '';
  ta.addEventListener('input', () => onInput(ta.value));
  wrap.appendChild(ta);
  return wrap;
}

let currentNode: HTMLElement | null = null;

export async function loadProfile(): Promise<void> {
  try {
    const p = await api.profile.me();
    state.profile = p;
    draft = fromResponse(p);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      state.profile = null;
      draft = emptyProfile();
    } else {
      throw err;
    }
  }
}

export async function renderProfile(host: HTMLElement): Promise<void> {
  currentNode = host;
  await loadProfile();
  rerender();
}

function rerender(): void {
  if (!currentNode) return;
  clear(currentNode);
  currentNode.appendChild(buildView());
}

function buildView(): HTMLElement {
  const root = el('div', { class: 'tab-inner' });

  // Header card
  const header = el(
    'div',
    { class: 'page-intro-row' },
    el(
      'div',
      { class: 'page-intro' },
      el('h1', {}, 'Your job share profile'),
      el('p', {}, 'Edit your details, then publish to enter the matching pool.'),
    ),
  );
  root.appendChild(header);

  // Status pill (draft / published)
  const statusPill = el(
    'div',
    { class: 'profile-completeness' },
    el('div', {
      class: `completeness-label`,
    }, state.profile ? `${state.profile.status === 'published' ? 'Published — visible to matches' : 'Draft — not visible yet'}` : 'No profile yet'),
  );
  root.appendChild(statusPill);

  // Required fields
  const required = el('div', { class: 'form-group' });
  required.appendChild(el('div', { class: 'form-group-title' }, 'REQUIRED INFO'));

  // Grade
  const gradeWrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, 'Grade *'));
  const gradeRow = el('div', { class: 'pill-row' });
  for (const g of GRADES) {
    gradeRow.appendChild(
      pillButton(g, draft.grade === g, () => {
        draft.grade = g as Grade;
        rerender();
      }),
    );
  }
  gradeWrap.appendChild(gradeRow);
  required.appendChild(gradeWrap);

  // Directorates
  const dirWrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, 'Directorates / areas you would consider *'));
  const dirRow = el('div', { class: 'pill-row' });
  for (const d of FCDO_DIRECTORATES) {
    dirRow.appendChild(
      pillButton(
        d,
        draft.directorates.includes(d),
        () => {
          draft.directorates = draft.directorates.includes(d)
            ? draft.directorates.filter((x) => x !== d)
            : [...draft.directorates, d];
          rerender();
        },
      ),
    );
  }
  dirWrap.appendChild(dirRow);
  required.appendChild(dirWrap);

  // Days I work
  const daysWrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, 'Days I work *'));
  daysWrap.appendChild(dayPicker());
  required.appendChild(daysWrap);

  // Location
  const locWrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, 'Location *'));
  const locRow = el('div', { class: 'pill-row' });
  for (const L of LOCATIONS) {
    locRow.appendChild(
      pillButton(L, draft.location === L, () => {
        draft.location = L;
        rerender();
      }),
    );
  }
  locWrap.appendChild(locRow);
  required.appendChild(locWrap);

  root.appendChild(required);

  // Optional info
  const optional = el('div', { class: 'form-group' });
  optional.appendChild(el('div', { class: 'form-group-title' }, 'OPTIONAL INFO'));
  optional.appendChild(textInput('Overseas post', draft.overseasPost ?? null, (v) => (draft.overseasPost = v || null)));
  optional.appendChild(textInput('FTE', draft.fte ?? null, (v) => (draft.fte = v || null), 40));

  const negWrap = el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, 'Are your days negotiable?'));
  const negRow = el('div', { class: 'pill-row' });
  for (const n of ['yes', 'possibly', 'no'] as const) {
    negRow.appendChild(
      pillButton(n[0]!.toUpperCase() + n.slice(1), draft.daysNegotiable === n, () => {
        draft.daysNegotiable = n;
        rerender();
      }),
    );
  }
  negWrap.appendChild(negRow);
  optional.appendChild(negWrap);

  optional.appendChild(textareaInput('Availability', draft.availability ?? null, (v) => (draft.availability = v || null), 200));
  optional.appendChild(textareaInput('Skills & experience', draft.skills ?? null, (v) => (draft.skills = v || null)));
  optional.appendChild(textareaInput('Working pattern notes', draft.workingPatternNotes ?? null, (v) => (draft.workingPatternNotes = v || null)));
  optional.appendChild(textareaInput('Other information', draft.otherInfo ?? null, (v) => (draft.otherInfo = v || null)));
  root.appendChild(optional);

  // Visibility
  const visGroup = el('div', { class: 'form-group' });
  visGroup.appendChild(el('div', { class: 'form-group-title' }, 'WHO CAN FIND ME'));
  visGroup.appendChild(visibilityPicker('Grade', 'grade', 'same grade only', 'any grade'));
  visGroup.appendChild(visibilityPicker('Directorate', 'directorates', 'overlapping directorates only', 'any directorate'));
  visGroup.appendChild(visibilityPicker('Location', 'location', 'same location only', 'any location'));
  visGroup.appendChild(visibilityPicker('Day pattern', 'days', 'complementary days only', 'any pattern'));
  root.appendChild(visGroup);

  // Actions + status
  const actions = el('div', { class: 'form-actions' });
  const saveBtn = el('button', { type: 'button', class: 'btn-save' }, 'Save profile') as HTMLButtonElement;
  saveBtn.addEventListener('click', () => void onSave());
  actions.appendChild(saveBtn);

  if (state.profile?.status === 'published') {
    const unpubBtn = el('button', { type: 'button', class: 'btn-danger-soft' }, 'Unpublish');
    unpubBtn.addEventListener('click', () => void onUnpublish());
    actions.appendChild(unpubBtn);
  } else if (state.profile) {
    const pubBtn = el('button', { type: 'button', class: 'btn-primary-sm' }, 'Publish — make me discoverable');
    pubBtn.addEventListener('click', () => void onPublish());
    actions.appendChild(pubBtn);
  }
  root.appendChild(actions);

  saveStatus = el('div', { class: 'save-status', style: 'display:none' });
  root.appendChild(saveStatus);

  // GDPR controls
  const gdpr = el(
    'div',
    { class: 'form-actions', style: 'margin-top:24px;' },
  );
  const exportBtn = el('button', { type: 'button', class: 'btn-ghost-small' }, 'Export my data');
  exportBtn.addEventListener('click', () => void onExport());
  gdpr.appendChild(exportBtn);
  const deleteBtn = el('button', { type: 'button', class: 'btn-danger-soft' }, 'Delete my data…');
  deleteBtn.addEventListener('click', () => void onDelete());
  gdpr.appendChild(deleteBtn);
  root.appendChild(gdpr);

  return root;
}

async function onSave(): Promise<void> {
  setStatus('Saving…', '');
  try {
    state.profile = await api.profile.save(draft);
    draft = fromResponse(state.profile);
    setStatus('Profile saved.', 'ok');
    rerender();
  } catch (err) {
    setStatus(toMessage(err), 'error');
  }
}

async function onPublish(): Promise<void> {
  setStatus('Publishing…', '');
  try {
    state.profile = await api.profile.publish();
    draft = fromResponse(state.profile);
    setStatus('Published — you are visible to matches.', 'ok');
    rerender();
  } catch (err) {
    setStatus(toMessage(err), 'error');
  }
}

async function onUnpublish(): Promise<void> {
  setStatus('Unpublishing…', '');
  try {
    state.profile = await api.profile.unpublish();
    draft = fromResponse(state.profile);
    setStatus('Unpublished — back to draft.', 'ok');
    rerender();
  } catch (err) {
    setStatus(toMessage(err), 'error');
  }
}

async function onExport(): Promise<void> {
  try {
    const data = await api.me.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', {
      href: url,
      download: `pairup-export-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('Export downloaded.', 'ok');
  } catch (err) {
    setStatus(toMessage(err), 'error');
  }
}

async function onDelete(): Promise<void> {
  const typed = window.prompt('Type DELETE to permanently erase your profile, requests and connections.');
  if (typed !== 'DELETE') return;
  try {
    await api.me.deleteAccount();
    location.assign('/');
  } catch (err) {
    setStatus(toMessage(err), 'error');
  }
}

function toMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}
