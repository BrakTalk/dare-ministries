/**
 * @vitest-environment happy-dom
 *
 * Field note save-toast flow tests, generated from the
 * noteForm → saveNote → (keep editor open | close modal) → showToast
 * sequence diagram. Spec: docs/roster-save-toast-seq-tests.md
 *
 * Boots the real roster.js IIFE against the real roster.njk body markup.
 * All network traffic goes through a mocked fetch router — no disk or
 * network side effects. No existing test file covers the roster UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rosterSource = readFileSync(resolve(here, '../roster.js'), 'utf8');
const rosterMarkup = (() => {
  const html = readFileSync(resolve(here, '../../roster.njk'), 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!body) throw new Error('roster.njk: could not extract <body>');
  // Drop the real <script src> so happy-dom does not try to load it.
  return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

// ─── Fixtures and fetch router ────────────────────────────────────────────────

interface NoteRecord {
  id: string;
  title: string;
  status: 'draft' | 'published';
  start_date: string;
  end_date: string | null;
  body: string;
  photos: unknown[];
}

interface LoggedRequest {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

interface FailNext {
  method: string;
  urlPart: string;
  status: number;
  error?: string;
}

let notesDb: NoteRecord[] = [];
let fetchLog: LoggedRequest[] = [];
let failNext: FailNext | null = null;
let holdNext: { method: string; urlPart: string; gate: Promise<void> } | null = null;
let afterPatch: (() => void) | null = null;
let idSeq = 0;

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  idSeq += 1;
  return {
    id: 'seed-' + idSeq,
    title: 'Trip ' + idSeq,
    status: 'draft',
    start_date: '2026-07-01',
    end_date: null,
    body: 'Recap body',
    photos: [],
    ...overrides,
  };
}

function jsonRes(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const mockFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  fetchLog.push({ url, method, body });

  if (holdNext && holdNext.method === method && url.includes(holdNext.urlPart)) {
    const gate = holdNext.gate;
    holdNext = null;
    await gate;
  }
  if (failNext && failNext.method === method && url.includes(failNext.urlPart)) {
    const f = failNext;
    failNext = null;
    return jsonRes({ error: f.error ?? 'boom' }, f.status);
  }

  if (url.startsWith('/api/admin/login')) return jsonRes({ authenticated: true });
  if (url.startsWith('/api/admin/volunteers')) return jsonRes([]);
  if (url.startsWith('/api/admin/contacts')) return jsonRes([]);
  if (url.startsWith('/api/impact-stats')) return jsonRes({});

  if (url.startsWith('/api/admin/field-notes')) {
    if (method === 'GET') {
      return jsonRes(notesDb.map((n) => ({ ...n, photos: [...n.photos] })));
    }
    if (method === 'POST') {
      const note = makeNote({ status: 'draft', ...body, id: 'created-' + ++idSeq });
      notesDb.push(note);
      return jsonRes({ ...note });
    }
    if (method === 'PATCH') {
      const note = notesDb.find((n) => n.id === body.id);
      if (note) Object.assign(note, body);
      if (afterPatch) {
        const hook = afterPatch;
        afterPatch = null;
        hook();
      }
      return jsonRes({ id: body.id });
    }
    if (method === 'DELETE') {
      notesDb = notesDb.filter((n) => n.id !== body.id);
      return jsonRes({ ok: true });
    }
  }
  return jsonRes({ error: 'unrouted ' + method + ' ' + url }, 404);
});

// ─── Harness ──────────────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const hidden = (id: string) => $(id).classList.contains('hidden');

async function flush() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

async function boot(seed: NoteRecord[] = []) {
  notesDb = seed;
  document.body.innerHTML = rosterMarkup;
  new Function(rosterSource)();
  await flush();
}

function fieldNoteWrites(method?: string) {
  return fetchLog.filter(
    (r) =>
      r.url.startsWith('/api/admin/field-notes') &&
      r.method !== 'GET' &&
      (!method || r.method === method)
  );
}

function openNewEntry() {
  $('newNoteBtn').click();
}

function openFromList(id: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`#noteList .note-card[data-id="${id}"]`)!;
  expect(card).toBeTruthy();
  card.click();
  return card;
}

function fillForm(fields: { title?: string; start?: string; end?: string; body?: string }) {
  if (fields.title !== undefined) input('note-title').value = fields.title;
  if (fields.start !== undefined) input('note-start').value = fields.start;
  if (fields.end !== undefined) input('note-end').value = fields.end;
  if (fields.body !== undefined) input('note-body').value = fields.body;
}

async function submitForm() {
  $('noteForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

function deferred() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
}

beforeEach(() => {
  fetchLog = [];
  failNext = null;
  holdNext = null;
  afterPatch = null;
  idSeq = 0;
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Phase A: submission and validation ───────────────────────────────────────

describe('Phase A: submission and validation (noteForm → saveNote)', () => {
  it('✅ SAVE-A1 new note happy path sends a trimmed POST payload and refreshes', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: '  Augusta Trip  ', start: '2026-07-10', body: 'We hung drywall.' });
    const getsBefore = fetchLog.filter(
      (r) => r.method === 'GET' && r.url.startsWith('/api/admin/field-notes')
    ).length;
    await submitForm();

    const writes = fieldNoteWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(writes[0].body).toEqual({
      title: 'Augusta Trip',
      start_date: '2026-07-10',
      end_date: null,
      body: 'We hung drywall.',
    });
    const getsAfter = fetchLog.filter(
      (r) => r.method === 'GET' && r.url.startsWith('/api/admin/field-notes')
    ).length;
    expect(getsAfter).toBe(getsBefore + 1);
  });

  it('❌ SAVE-A2 missing title blocks the save client-side', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: '', start: '2026-07-10' });
    await submitForm();

    expect(fieldNoteWrites()).toHaveLength(0);
    expect(hidden('noteError')).toBe(false);
    expect($('noteError').textContent).toBe('A title and trip start date are required.');
    expect(hidden('noteOverlay')).toBe(false);
    expect(hidden('toast')).toBe(true);
  });

  it('❌ SAVE-A3 missing start date blocks the save client-side', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: 'Augusta Trip', start: '' });
    await submitForm();

    expect(fieldNoteWrites()).toHaveLength(0);
    expect(hidden('noteError')).toBe(false);
    expect(hidden('noteOverlay')).toBe(false);
    expect(hidden('toast')).toBe(true);
  });

  it('⚠️ SAVE-A4 whitespace-only title is rejected before hitting the network', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: '   ', start: '2026-07-10' });
    await submitForm();

    expect(fieldNoteWrites()).toHaveLength(0);
    expect(hidden('noteError')).toBe(false);
  });

  it('⚠️ SAVE-A5 save button is disabled while the request is in flight', async () => {
    const note = makeNote();
    await boot([note]);
    openFromList(note.id);

    const { gate, release } = deferred();
    holdNext = { method: 'PATCH', urlPart: '/api/admin/field-notes', gate };
    const btn = $('noteSaveBtn') as HTMLButtonElement;

    const submission = submitForm();
    await flush();
    expect(btn.disabled).toBe(true);

    release();
    await submission;
    await flush();
    expect(btn.disabled).toBe(false);
    expect(fieldNoteWrites('PATCH')).toHaveLength(1);
  });

  it('❌ SAVE-A6 server error keeps the modal open with inline error, no toast', async () => {
    const note = makeNote();
    await boot([note]);
    openFromList(note.id);
    failNext = { method: 'PATCH', urlPart: '/api/admin/field-notes', status: 500, error: 'db exploded' };
    await submitForm();

    expect(hidden('noteOverlay')).toBe(false);
    expect(hidden('noteError')).toBe(false);
    expect($('noteError').textContent).toBe('Save failed: db exploded');
    expect(hidden('toast')).toBe(true);
    expect(($('noteSaveBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('⚠️ SAVE-A7 401 mid-save drops to the login view (modal-over-login quirk pinned)', async () => {
    const note = makeNote();
    await boot([note]);
    openFromList(note.id);
    failNext = { method: 'PATCH', urlPart: '/api/admin/field-notes', status: 401 };
    await submitForm();

    expect(hidden('loginView')).toBe(false);
    expect(hidden('consoleView')).toBe(true);
    expect(hidden('toast')).toBe(true);
    expect($('noteError').textContent).toBe('Save failed: Not authenticated');
    // Current behavior: the overlay lives outside #consoleView, so it stays
    // visible on top of the login screen. A future fix should flip this.
    expect(hidden('noteOverlay')).toBe(false);
  });
});

// ─── Phase B: first draft save keeps the editor open ─────────────────────────

describe('Phase B: first draft save (keep editor open)', () => {
  it('✅ SAVE-B1 first save keeps the editor open and toasts the photo hint', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: 'Augusta Trip', start: '2026-07-10' });
    await submitForm();

    expect(hidden('noteOverlay')).toBe(false);
    expect(hidden('toast')).toBe(false);
    expect($('toast').textContent).toBe('Draft saved — you can add photos now.');
  });

  it('✅ SAVE-B2 first save unlocks photos, publish, and delete controls', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: 'Augusta Trip', start: '2026-07-10' });
    expect(hidden('notePhotos')).toBe(true);
    await submitForm();

    expect(hidden('notePhotos')).toBe(false);
    expect(hidden('notePhotoLocked')).toBe(true);
    expect(hidden('notePublishBtn')).toBe(false);
    expect($('notePublishBtn').textContent).toBe('Publish');
    expect(hidden('noteDeleteBtn')).toBe(false);
    expect($('noteSaveBtn').textContent).toBe('Save Draft');
  });

  it('✅ SAVE-B3 second submit PATCHes the server-issued id and then closes', async () => {
    await boot();
    openNewEntry();
    fillForm({ title: 'Augusta Trip', start: '2026-07-10' });
    await submitForm();
    const created = fieldNoteWrites('POST');
    expect(created).toHaveLength(1);

    fillForm({ title: 'Augusta Trip, day two' });
    await submitForm();

    const patches = fieldNoteWrites('PATCH');
    expect(fieldNoteWrites('POST')).toHaveLength(1); // still exactly one POST
    expect(patches).toHaveLength(1);
    expect(patches[0].body!.id).toMatch(/^created-/);
    expect(patches[0].body!.title).toBe('Augusta Trip, day two');
    expect(hidden('noteOverlay')).toBe(true);
    expect($('toast').textContent).toBe('Draft saved.');
  });
});

// ─── Phase C: later save closes the modal ─────────────────────────────────────

describe('Phase C: later save (close modal + toast)', () => {
  it('✅ SAVE-C1 saving an existing draft closes the modal and toasts "Draft saved."', async () => {
    const note = makeNote({ title: 'Existing draft' });
    await boot([note]);
    openFromList(note.id);
    fillForm({ body: 'Updated recap' });
    await submitForm();

    const patches = fieldNoteWrites('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body!.id).toBe(note.id);
    expect(hidden('noteOverlay')).toBe(true);
    expect(hidden('toast')).toBe(false);
    expect($('toast').textContent).toBe('Draft saved.');
  });

  it('✅ SAVE-C2 saving a published note toasts the rebuild reminder, without touching status', async () => {
    const note = makeNote({ status: 'published', title: 'Live entry' });
    await boot([note]);
    openFromList(note.id);
    fillForm({ body: 'Corrected a typo' });
    await submitForm();

    const patches = fieldNoteWrites('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).not.toHaveProperty('status');
    expect(hidden('noteOverlay')).toBe(true);
    expect($('toast').textContent).toBe(
      'Saved — changes go live after the site rebuilds (~1–2 min).'
    );
    expect(notesDb[0].status).toBe('published');
  });

  it('✅ SAVE-C3 closing without a refresh restores focus to the triggering card', async () => {
    // The save path re-renders the list, detaching the trigger (closeNote's
    // document.contains guard then skips restore — known gap, see spec).
    // The restorable contract is pinned via the cancel path.
    const note = makeNote();
    await boot([note]);
    const card = openFromList(note.id);
    expect(document.activeElement).toBe(input('note-title'));

    $('noteCancelBtn').click();
    expect(hidden('noteOverlay')).toBe(true);
    expect(document.activeElement).toBe(card);
  });

  it('⚠️ SAVE-C4 refresh failure after a successful PATCH surfaces as a save error', async () => {
    const note = makeNote();
    await boot([note]);
    openFromList(note.id);
    fillForm({ body: 'This write will land' });
    failNext = { method: 'GET', urlPart: '/api/admin/field-notes', status: 500, error: 'refresh died' };
    await submitForm();

    // The PATCH landed…
    expect(fieldNoteWrites('PATCH')).toHaveLength(1);
    expect(notesDb[0].body).toBe('This write will land');
    // …but the author is told the save failed. Pinned as current (misleading) behavior.
    expect(hidden('noteOverlay')).toBe(false);
    expect($('noteError').textContent).toBe('Save failed: refresh died');
    expect(hidden('toast')).toBe(true);
    expect(($('noteSaveBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('⚠️ SAVE-C5 note deleted concurrently between PATCH and refresh does not crash', async () => {
    const note = makeNote();
    await boot([note]);
    openFromList(note.id);
    fillForm({ body: 'Racing a delete' });
    afterPatch = () => {
      notesDb = notesDb.filter((n) => n.id !== note.id);
    };
    await submitForm();

    // currentNote resolves to undefined → non-published close path.
    expect(hidden('noteOverlay')).toBe(true);
    expect($('toast').textContent).toBe('Draft saved.');
    expect(($('noteSaveBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(hidden('noteError')).toBe(true);
  });
});

// ─── Phase D: toast component ─────────────────────────────────────────────────

describe('Phase D: toast component (showToast)', () => {
  it('✅ SAVE-D1 toast auto-dismisses after 4 seconds', async () => {
    const note = makeNote();
    await boot([note]);
    vi.useFakeTimers();
    openFromList(note.id);
    await submitForm();

    expect(hidden('toast')).toBe(false);
    vi.advanceTimersByTime(3999);
    expect(hidden('toast')).toBe(false);
    vi.advanceTimersByTime(2);
    expect(hidden('toast')).toBe(true);
  });

  it('⚠️ SAVE-D2 a second toast resets the dismiss timer', async () => {
    const a = makeNote();
    const b = makeNote({ status: 'published' });
    await boot([a, b]);
    vi.useFakeTimers();

    openFromList(a.id);
    await submitForm();
    expect($('toast').textContent).toBe('Draft saved.');
    vi.advanceTimersByTime(3000);

    openFromList(b.id);
    await submitForm();
    expect($('toast').textContent).toBe(
      'Saved — changes go live after the site rebuilds (~1–2 min).'
    );

    vi.advanceTimersByTime(3000); // 6s after first toast, 3s after second
    expect(hidden('toast')).toBe(false); // first timer was cleared
    vi.advanceTimersByTime(1001);
    expect(hidden('toast')).toBe(true);
  });

  it('✅ SAVE-D3 toast is announced politely to assistive tech', async () => {
    await boot();
    const toasts = document.querySelectorAll('#toast, .toast');
    expect(toasts).toHaveLength(1);
    expect($('toast').getAttribute('role')).toBe('status');
    expect($('toast').getAttribute('aria-live')).toBe('polite');
  });
});

// ─── Phase E: adjacent flows sharing saveNote ─────────────────────────────────

describe('Phase E: publish/cancel guard rails', () => {
  it('✅ SAVE-E1 publish keeps the modal open and does not fire the close-toast', async () => {
    const note = makeNote();
    await boot([note]);
    openFromList(note.id);
    $('notePublishBtn').click();
    await flush();

    const patches = fieldNoteWrites('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body!.status).toBe('published');
    expect(hidden('noteOverlay')).toBe(false);
    expect($('notePublishBtn').textContent).toBe('Unpublish');
    expect($('noteSaveBtn').textContent).toBe('Save Changes');
    expect(hidden('noteStatusLine')).toBe(false);
    expect(hidden('toast')).toBe(true);
  });

  it('❌ SAVE-E2 declining the unpublish confirm sends nothing', async () => {
    const note = makeNote({ status: 'published' });
    await boot([note]);
    vi.stubGlobal('confirm', vi.fn(() => false));
    openFromList(note.id);
    $('notePublishBtn').click();
    await flush();

    expect(fieldNoteWrites()).toHaveLength(0);
    expect(notesDb[0].status).toBe('published');
    expect(hidden('noteOverlay')).toBe(false);
  });

  it('❌ SAVE-E3 cancel and Escape close without saving and without a toast', async () => {
    const note = makeNote();
    await boot([note]);

    openFromList(note.id);
    fillForm({ title: 'Edited but abandoned' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hidden('noteOverlay')).toBe(true);

    openFromList(note.id);
    fillForm({ title: 'Edited then cancelled' });
    $('noteCancelBtn').click();
    expect(hidden('noteOverlay')).toBe(true);

    expect(fieldNoteWrites()).toHaveLength(0);
    expect(hidden('toast')).toBe(true);
  });
});

// ─── Cross-cutting security ───────────────────────────────────────────────────

describe('Cross-cutting security', () => {
  it('🔒 SAVE-X1 author-controlled note title cannot inject markup into the list', async () => {
    const payload = '<img src=x onerror="window.__pwned=1">\'"';
    const note = makeNote({ title: payload });
    await boot([note]);

    expect(document.querySelector('#noteList img')).toBeNull();
    const name = document.querySelector('#noteList .contact-name')!;
    expect(name.textContent).toBe(payload);
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
