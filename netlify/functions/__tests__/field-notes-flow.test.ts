// Field Notes publish-flow test suite, generated from the sequence diagram.
// Spec: docs/field-notes-seq-tests.md — test IDs (N*, P*, M*, B*, S*, R*)
// match the spec. All external dependencies (Postgres, Blobs, auth, build
// hook) are mocked; no network or disk I/O.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared mock state (hoisted so vi.mock factories can close over it) ──────

interface DbCall {
  text: string;
  values: unknown[];
}
interface DbRoute {
  match: RegExp;
  handler: (values: unknown[]) => unknown[] | Promise<unknown[]>;
}

const state = vi.hoisted(() => ({
  authed: true,
  dbCalls: [] as { text: string; values: unknown[] }[],
  dbRoutes: [] as { match: RegExp; handler: (values: unknown[]) => unknown[] | Promise<unknown[]> }[],
  timeline: [] as string[],
  store: null as Record<string, ReturnType<typeof vi.fn>> | null,
}));

vi.mock('@netlify/database', () => ({
  getDatabase: () => ({
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ').trim();
      state.dbCalls.push({ text, values });
      state.timeline.push(`db:${text.slice(0, 40)}`);
      for (const route of state.dbRoutes) {
        if (route.match.test(text)) return route.handler(values);
      }
      return [];
    },
  }),
}));

vi.mock('@netlify/blobs', () => ({
  getStore: () => state.store,
}));

vi.mock('../lib/auth.mjs', () => ({
  requireAuth: () =>
    state.authed
      ? null
      : new Response(JSON.stringify({ error: 'Not authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
}));

import notesHandler from '../admin-field-notes.mjs';
import photosHandler from '../admin-field-note-photos.mjs';
import servePhotoHandler from '../field-photo.mjs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import fieldNotesData from '../../../src/_data/fieldNotes.js';
import eleventyInit from '../../../.eleventy.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

function onDb(match: RegExp, rows: unknown[] | ((values: unknown[]) => unknown[])) {
  state.dbRoutes.push({
    match,
    handler: typeof rows === 'function' ? rows : () => rows,
  });
}

function dbCall(match: RegExp): DbCall | undefined {
  return state.dbCalls.find((c) => match.test(c.text));
}

function jsonReq(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/admin/field-notes', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body), duplex: 'half' }),
  } as RequestInit);
}

function photoUploadReq(bytes: Uint8Array, contentType: string, noteId = NOTE_ID, alt = ''): Request {
  const url = new URL('http://localhost/api/admin/field-note-photos');
  url.searchParams.set('note_id', noteId);
  if (alt) url.searchParams.set('alt', alt);
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes,
    duplex: 'half',
  } as RequestInit);
}

function photoJsonReq(method: string, body: unknown): Request {
  return new Request('http://localhost/api/admin/field-note-photos', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    duplex: 'half',
  } as RequestInit);
}

interface NoteRow {
  id: string;
  slug: string;
  title: string;
  start_date: string;
  end_date: string | null;
  body: string;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function noteRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: NOTE_ID,
    slug: '2026-07-augusta-trip',
    title: 'Augusta Trip',
    start_date: '2026-07-16',
    end_date: '2026-07-18',
    body: 'Recap text',
    status: 'draft',
    published_at: null,
    created_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

let hookFetch: ReturnType<typeof vi.fn>;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  state.authed = true;
  state.dbCalls.length = 0;
  state.dbRoutes.length = 0;
  state.timeline.length = 0;
  state.store = {
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => {
      state.timeline.push('blob:delete');
    }),
    list: vi.fn(async () => ({ blobs: [] })),
    getWithMetadata: vi.fn(async () => null),
  };

  savedEnv.BUILD_HOOK_URL = process.env.BUILD_HOOK_URL;
  savedEnv.NETLIFY_DATABASE_URL = process.env.NETLIFY_DATABASE_URL;
  process.env.BUILD_HOOK_URL = 'https://hooks.netlify.test/build';
  delete process.env.NETLIFY_DATABASE_URL;

  hookFetch = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', hookFetch);
});

afterEach(() => {
  process.env.BUILD_HOOK_URL = savedEnv.BUILD_HOOK_URL;
  if (savedEnv.NETLIFY_DATABASE_URL === undefined) delete process.env.NETLIFY_DATABASE_URL;
  else process.env.NETLIFY_DATABASE_URL = savedEnv.NETLIFY_DATABASE_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Phase: Note save & publish ──────────────────────────────────────────────

describe('Phase: Note save & publish (admin-field-notes)', () => {
  it('✅ N1 creates a valid draft with a dated slug', async () => {
    onDb(/INSERT INTO field_notes/, (values) => [{ id: NOTE_ID, slug: values[0] }]);
    const res = await notesHandler(
      jsonReq('POST', { title: 'Roswell UMC / DARE Trip to Augusta, GA', start_date: '2026-07-16', end_date: '2026-07-18', body: 'Recap' })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, id: NOTE_ID });
    expect(body.slug).toBe('2026-07-roswell-umc-dare-trip-to-augusta-ga');
  });

  it('❌ N2 rejects a missing title with 400 and no INSERT', async () => {
    const res = await notesHandler(jsonReq('POST', { start_date: '2026-07-16' }));
    expect(res.status).toBe(400);
    expect(dbCall(/INSERT/)).toBeUndefined();
  });

  it('❌ N3 rejects a malformed start_date', async () => {
    const res = await notesHandler(jsonReq('POST', { title: 'Trip', start_date: 'July 16' }));
    expect(res.status).toBe(400);
    expect(dbCall(/INSERT/)).toBeUndefined();
  });

  it('❌ N4 rejects a malformed end_date', async () => {
    const res = await notesHandler(jsonReq('POST', { title: 'Trip', start_date: '2026-07-16', end_date: '18-07-2026' }));
    expect(res.status).toBe(400);
  });

  it('⚠️ N5 retries a slug collision with a -2 suffix', async () => {
    let attempts = 0;
    onDb(/INSERT INTO field_notes/, (values) => {
      attempts++;
      if (attempts === 1) throw new Error('duplicate key value violates unique constraint "field_notes_slug_key"');
      return [{ id: NOTE_ID, slug: values[0] }];
    });
    const res = await notesHandler(jsonReq('POST', { title: 'Augusta Trip', start_date: '2026-07-16' }));
    expect(res.status).toBe(201);
    expect((await res.json()).slug).toBe('2026-07-augusta-trip-2');
    expect(attempts).toBe(2);
  });

  it('⚠️ N6 caps an oversized body at 50,000 chars instead of rejecting', async () => {
    onDb(/INSERT INTO field_notes/, (values) => [{ id: NOTE_ID, slug: values[0] }]);
    const res = await notesHandler(
      jsonReq('POST', { title: 'Trip', start_date: '2026-07-16', body: 'x'.repeat(60000) })
    );
    expect(res.status).toBe(201);
    const insert = dbCall(/INSERT INTO field_notes/)!;
    expect((insert.values[4] as string).length).toBe(50000);
  });

  it('✅ N7 publish sets published_at and fires the build hook once', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    const res = await notesHandler(jsonReq('PATCH', { id: NOTE_ID, status: 'published' }));
    expect(res.status).toBe(200);
    const update = dbCall(/UPDATE field_notes SET/)!;
    expect(update.values[5]).toBe('published');
    expect(update.values[6]).toBeTruthy(); // fresh published_at
    expect(hookFetch).toHaveBeenCalledTimes(1);
    expect(hookFetch).toHaveBeenCalledWith('https://hooks.netlify.test/build', { method: 'POST' });
  });

  it('⚠️ N8 republish keeps the original published_at', async () => {
    const original = '2026-01-01T00:00:00.000Z';
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow({ status: 'draft', published_at: original })]);
    await notesHandler(jsonReq('PATCH', { id: NOTE_ID, status: 'published' }));
    const update = dbCall(/UPDATE field_notes SET/)!;
    expect(update.values[6]).toBe(original);
  });

  it('⚠️ N9 regenerates the slug when a never-published draft is retitled', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    onDb(/SELECT 1 FROM field_notes WHERE slug/, []);
    await notesHandler(jsonReq('PATCH', { id: NOTE_ID, title: 'Valdosta Trip' }));
    const update = dbCall(/UPDATE field_notes SET/)!;
    expect(update.values[4]).toBe('2026-07-valdosta-trip');
  });

  it('⚠️ N10 freezes the slug once the note has ever been published', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [
      noteRow({ status: 'draft', published_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    await notesHandler(jsonReq('PATCH', { id: NOTE_ID, title: 'Totally New Title' }));
    const update = dbCall(/UPDATE field_notes SET/)!;
    expect(update.values[4]).toBe('2026-07-augusta-trip'); // unchanged
  });

  it('⚠️ N11 suffixes a regenerated draft slug that collides', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    onDb(/SELECT 1 FROM field_notes WHERE slug/, [{ '?column?': 1 }]);
    await notesHandler(jsonReq('PATCH', { id: NOTE_ID, title: 'Valdosta Trip' }));
    const update = dbCall(/UPDATE field_notes SET/)!;
    expect(update.values[4]).toBe('2026-07-valdosta-trip-2');
  });

  it('❌ N12 rejects an invalid status value', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    const res = await notesHandler(jsonReq('PATCH', { id: NOTE_ID, status: 'archived' }));
    expect(res.status).toBe(400);
    expect(dbCall(/UPDATE field_notes/)).toBeUndefined();
  });

  it('❌ N13 rejects a non-UUID id before any DB access', async () => {
    const res = await notesHandler(jsonReq('PATCH', { id: '1 OR 1=1' }));
    expect(res.status).toBe(400);
    expect(state.dbCalls).toHaveLength(0);
  });

  it('❌ N14 returns 404 for an unknown note id', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, []);
    const res = await notesHandler(jsonReq('PATCH', { id: OTHER_ID, title: 'X' }));
    expect(res.status).toBe(404);
  });

  it('✅ N15 draft edits do not fire the build hook', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    const res = await notesHandler(jsonReq('PATCH', { id: NOTE_ID, body: 'Updated recap' }));
    expect(res.status).toBe(200);
    expect(hookFetch).not.toHaveBeenCalled();
  });

  it('✅ N16 unpublishing fires the build hook', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [
      noteRow({ status: 'published', published_at: '2026-07-01T00:00:00.000Z' }),
    ]);
    await notesHandler(jsonReq('PATCH', { id: NOTE_ID, status: 'draft' }));
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('✅ N17 deleting a published note removes blobs, the row, and rebuilds', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [
      noteRow({ status: 'published', published_at: '2026-07-01T00:00:00.000Z' }),
    ]);
    state.store!.list.mockResolvedValue({
      blobs: [{ key: `${NOTE_ID}/a` }, { key: `${NOTE_ID}/b` }],
    });
    const res = await notesHandler(jsonReq('DELETE', { id: NOTE_ID }));
    expect(res.status).toBe(200);
    expect(state.store!.list).toHaveBeenCalledWith({ prefix: `${NOTE_ID}/` });
    expect(state.store!.delete).toHaveBeenCalledTimes(2);
    expect(dbCall(/DELETE FROM field_notes/)).toBeDefined();
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('⚠️ N18 deleting a draft does not fire the build hook', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    const res = await notesHandler(jsonReq('DELETE', { id: NOTE_ID }));
    expect(res.status).toBe(200);
    expect(hookFetch).not.toHaveBeenCalled();
  });

  it('❌ N19 deleting an unknown id returns 404', async () => {
    onDb(/SELECT \* FROM field_notes WHERE id/, []);
    const res = await notesHandler(jsonReq('DELETE', { id: OTHER_ID }));
    expect(res.status).toBe(404);
  });

  it('❌ N20 unsupported methods return 405', async () => {
    const res = await notesHandler(jsonReq('PUT', {}));
    expect(res.status).toBe(405);
  });

  it('🔒 N21 rejects every unauthenticated method with 401 and zero DB access', async () => {
    state.authed = false;
    for (const req of [
      jsonReq('GET'),
      jsonReq('POST', { title: 'T', start_date: '2026-07-16' }),
      jsonReq('PATCH', { id: NOTE_ID }),
      jsonReq('DELETE', { id: NOTE_ID }),
    ]) {
      const res = await notesHandler(req);
      expect(res.status).toBe(401);
    }
    expect(state.dbCalls).toHaveLength(0);
  });

  it('⚠️ N22 a failing build hook never fails the request', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hookFetch.mockRejectedValue(new Error('hook down'));
    onDb(/SELECT \* FROM field_notes WHERE id/, [noteRow()]);
    const res = await notesHandler(jsonReq('PATCH', { id: NOTE_ID, status: 'published' }));
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith('Build hook failed:', expect.any(Error));
  });

  it('✅ N23 admin GET returns drafts and published notes with photo URLs', async () => {
    onDb(/SELECT \* FROM field_notes ORDER BY/, [
      noteRow({ status: 'published' }),
      noteRow({ id: OTHER_ID, slug: '2026-06-draft', status: 'draft' }),
    ]);
    onDb(/SELECT \* FROM field_note_photos ORDER BY/, [
      { id: PHOTO_ID, note_id: NOTE_ID, alt: 'Crew', is_cover: true, sort_order: 0 },
    ]);
    const res = await notesHandler(jsonReq('GET'));
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((n: { status: string }) => n.status)).toContain('draft');
    expect(body[0].photos[0].url).toBe(`/images/field/${NOTE_ID}/${PHOTO_ID}`);
    expect(body[1].photos).toEqual([]);
  });
});

// ─── Phase: Photo upload ─────────────────────────────────────────────────────

describe('Phase: Photo upload (admin-field-note-photos POST)', () => {
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  function stubNoteExists(status: 'draft' | 'published' = 'draft') {
    onDb(/SELECT id FROM field_notes WHERE id/, [{ id: NOTE_ID }]);
    onDb(/INSERT INTO field_note_photos/, [{ id: PHOTO_ID }]);
    onDb(/SELECT status FROM field_notes WHERE id/, [{ status }]);
  }

  it('✅ P1 stores a valid JPEG: 201, DB row, blob at <noteId>/<photoId>', async () => {
    stubNoteExists();
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true, id: PHOTO_ID, url: `/images/field/${NOTE_ID}/${PHOTO_ID}` });
    expect(state.store!.set).toHaveBeenCalledWith(
      `${NOTE_ID}/${PHOTO_ID}`,
      expect.anything(),
      { metadata: { contentType: 'image/jpeg' } }
    );
  });

  it('❌ P2 rejects a disallowed content type with 415 and no persistence', async () => {
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'text/plain'));
    expect(res.status).toBe(415);
    expect(dbCall(/INSERT/)).toBeUndefined();
    expect(state.store!.set).not.toHaveBeenCalled();
  });

  it('⚠️ P3 tolerates content-type parameters (image/jpeg; charset=utf-8)', async () => {
    stubNoteExists();
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg; charset=utf-8'));
    expect(res.status).toBe(201);
  });

  it('❌ P4 rejects an empty body with 400', async () => {
    const res = await photosHandler(photoUploadReq(new Uint8Array(0), 'image/png'));
    expect(res.status).toBe(400);
  });

  it('❌ P5 rejects an oversize body with 413 before any persistence', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const res = await photosHandler(photoUploadReq(big, 'image/jpeg'));
    expect(res.status).toBe(413);
    expect(dbCall(/INSERT/)).toBeUndefined();
    expect(state.store!.set).not.toHaveBeenCalled();
  });

  it('❌ P6 rejects a malformed note_id with 400 before the DB', async () => {
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg', '../../etc/passwd'));
    expect(res.status).toBe(400);
    expect(state.dbCalls).toHaveLength(0);
  });

  it('❌ P7 returns 404 for an unknown note_id', async () => {
    onDb(/SELECT id FROM field_notes WHERE id/, []);
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg', OTHER_ID));
    expect(res.status).toBe(404);
  });

  it('⚠️ P8 rolls back the metadata row when the blob write fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubNoteExists();
    state.store!.set.mockRejectedValue(new Error('blob store down'));
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg'));
    expect(res.status).toBe(500);
    const rollback = dbCall(/DELETE FROM field_note_photos WHERE id/)!;
    expect(rollback).toBeDefined();
    expect(rollback.values[0]).toBe(PHOTO_ID);
    expect(errSpy).toHaveBeenCalled();
  });

  it('✅ P9 uploading to a draft does not fire the build hook', async () => {
    stubNoteExists('draft');
    await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg'));
    expect(hookFetch).not.toHaveBeenCalled();
  });

  it('✅ P10 uploading to a published note fires the build hook', async () => {
    stubNoteExists('published');
    await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg'));
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('⚠️ P11 caps the alt caption at 300 chars', async () => {
    stubNoteExists();
    await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg', NOTE_ID, 'c'.repeat(400)));
    const insert = dbCall(/INSERT INTO field_note_photos/)!;
    expect((insert.values[2] as string).length).toBe(300);
  });

  it('🔒 P12 rejects an unauthenticated upload with 401 and zero side effects', async () => {
    state.authed = false;
    const res = await photosHandler(photoUploadReq(JPEG_BYTES, 'image/jpeg'));
    expect(res.status).toBe(401);
    expect(state.dbCalls).toHaveLength(0);
    expect(state.store!.set).not.toHaveBeenCalled();
  });
});

// ─── Phase: Photo manage ─────────────────────────────────────────────────────

describe('Phase: Photo manage (PATCH / DELETE)', () => {
  function stubPhotoExists(parentStatus: 'draft' | 'published' = 'draft') {
    onDb(/SELECT \* FROM field_note_photos WHERE id/, [
      { id: PHOTO_ID, note_id: NOTE_ID, alt: 'Old', is_cover: false, sort_order: 0 },
    ]);
    onDb(/SELECT status FROM field_notes WHERE id/, [{ status: parentStatus }]);
  }

  it('⚠️ M1 cover swap is a single atomic UPDATE scoped to the note', async () => {
    stubPhotoExists();
    const res = await photosHandler(photoJsonReq('PATCH', { id: PHOTO_ID, is_cover: true }));
    expect(res.status).toBe(200);
    const coverUpdates = state.dbCalls.filter((c) => /SET is_cover/.test(c.text));
    expect(coverUpdates).toHaveLength(1);
    expect(coverUpdates[0].text).toMatch(/SET is_cover = \(id = \$\) WHERE note_id/);
  });

  it('✅ M2 explicit un-cover only clears the target photo', async () => {
    stubPhotoExists();
    await photosHandler(photoJsonReq('PATCH', { id: PHOTO_ID, is_cover: false }));
    const coverUpdates = state.dbCalls.filter((c) => /SET is_cover/.test(c.text));
    expect(coverUpdates).toHaveLength(1);
    expect(coverUpdates[0].text).toMatch(/SET is_cover = FALSE WHERE id/);
  });

  it('✅ M3 photo delete removes the DB row strictly before the blob', async () => {
    stubPhotoExists();
    const res = await photosHandler(photoJsonReq('DELETE', { id: PHOTO_ID }));
    expect(res.status).toBe(200);
    const rowIdx = state.timeline.findIndex((e) => e.startsWith('db:DELETE FROM field_note_photos'));
    const blobIdx = state.timeline.indexOf('blob:delete');
    expect(rowIdx).toBeGreaterThanOrEqual(0);
    expect(blobIdx).toBeGreaterThan(rowIdx);
  });

  it('⚠️ M4 blob-delete failure surfaces an error but the row stays deleted', async () => {
    stubPhotoExists();
    state.store!.delete.mockRejectedValue(new Error('blob store down'));
    await expect(photosHandler(photoJsonReq('DELETE', { id: PHOTO_ID }))).rejects.toThrow('blob store down');
    expect(dbCall(/DELETE FROM field_note_photos/)).toBeDefined();
  });

  it('❌ M5 PATCHing an unknown photo returns 404', async () => {
    onDb(/SELECT \* FROM field_note_photos WHERE id/, []);
    const res = await photosHandler(photoJsonReq('PATCH', { id: PHOTO_ID, alt: 'X' }));
    expect(res.status).toBe(404);
  });

  it('⚠️ M6 a non-integer sort_order is ignored', async () => {
    stubPhotoExists();
    const res = await photosHandler(photoJsonReq('PATCH', { id: PHOTO_ID, sort_order: '2; DROP TABLE x' }));
    expect(res.status).toBe(200);
    expect(dbCall(/SET sort_order/)).toBeUndefined();
  });

  it('✅ M7 caption edit on a published note fires the build hook', async () => {
    stubPhotoExists('published');
    await photosHandler(photoJsonReq('PATCH', { id: PHOTO_ID, alt: 'New caption' }));
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Phase: Build-time load ──────────────────────────────────────────────────

describe('Phase: Build-time load (src/_data/fieldNotes.js)', () => {
  function stubPublished(rows: unknown[], photos: unknown[] = []) {
    process.env.NETLIFY_DATABASE_URL = 'postgres://test';
    onDb(/FROM field_notes WHERE status/, rows);
    onDb(/FROM field_note_photos WHERE note_id/, photos);
  }

  it('✅ B1 returns published notes with photos, cover, and date_display', async () => {
    stubPublished(
      [{ id: NOTE_ID, slug: 's', title: 'T', start_date: '2026-07-16', end_date: '2026-07-18', body: 'B', published_at: 'x' }],
      [
        { id: PHOTO_ID, note_id: NOTE_ID, alt: 'Crew', is_cover: false },
        { id: OTHER_ID, note_id: NOTE_ID, alt: 'Roof', is_cover: true },
      ]
    );
    const notes = await fieldNotesData();
    expect(notes).toHaveLength(1);
    expect(notes[0].photos).toHaveLength(2);
    expect(notes[0].photos[0].url).toBe(`/images/field/${NOTE_ID}/${PHOTO_ID}`);
    expect(notes[0].cover.alt).toBe('Roof'); // the is_cover photo wins
    expect(notes[0].date_display).toBe('July 16–18, 2026');
  });

  it('⚠️ B2 cover falls back to the first photo, else null', async () => {
    stubPublished(
      [
        { id: NOTE_ID, slug: 'a', title: 'A', start_date: '2026-07-16', end_date: null, body: '', published_at: 'x' },
        { id: OTHER_ID, slug: 'b', title: 'B', start_date: '2026-06-01', end_date: null, body: '', published_at: 'x' },
      ],
      [{ id: PHOTO_ID, note_id: NOTE_ID, alt: 'First', is_cover: false }]
    );
    const notes = await fieldNotesData();
    expect(notes[0].cover.alt).toBe('First');
    expect(notes[1].cover).toBeNull();
  });

  it('⚠️ B3 missing NETLIFY_DATABASE_URL yields [] with a warning, no throw', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.NETLIFY_DATABASE_URL;
    await expect(fieldNotesData()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NETLIFY_DATABASE_URL'));
    expect(state.dbCalls).toHaveLength(0);
  });

  it('❌ B4 a DB error with the env set fails the build (rejects)', async () => {
    process.env.NETLIFY_DATABASE_URL = 'postgres://test';
    onDb(/FROM field_notes WHERE status/, () => {
      throw new Error('connection refused');
    });
    await expect(fieldNotesData()).rejects.toThrow('connection refused');
  });

  it('⚠️ B5 zero published notes returns [] without querying photos', async () => {
    stubPublished([]);
    await expect(fieldNotesData()).resolves.toEqual([]);
    expect(dbCall(/field_note_photos/)).toBeUndefined();
  });

  it('✅ B6/B7 date_display variants: single day, cross-month, cross-year', async () => {
    stubPublished([
      { id: NOTE_ID, slug: 'a', title: 'A', start_date: '2026-05-09', end_date: null, body: '', published_at: 'x' },
      { id: OTHER_ID, slug: 'b', title: 'B', start_date: '2026-06-30', end_date: '2026-07-02', body: '', published_at: 'x' },
      { id: PHOTO_ID, slug: 'c', title: 'C', start_date: '2026-12-30', end_date: '2027-01-02', body: '', published_at: 'x' },
    ]);
    const notes = await fieldNotesData();
    const displays = notes.map((n: { date_display: string }) => n.date_display);
    expect(displays).toContain('May 9, 2026');
    expect(displays).toContain('June 30 – July 2, 2026');
    expect(displays).toContain('December 30, 2026 – January 2, 2027');
  });

  it("🔒 B8 the draft gate lives in the SQL itself (status = 'published')", async () => {
    stubPublished([]);
    await fieldNotesData();
    const query = dbCall(/FROM field_notes/)!;
    expect(query.text).toContain("WHERE status = 'published'");
  });
});

// ─── Phase: Public photo serving ─────────────────────────────────────────────

describe('Phase: Public photo serving (field-photo)', () => {
  const serveReq = new Request('http://localhost/images/field/x/y');

  it('✅ S1 serves an existing blob with stored content type and immutable caching', async () => {
    state.store!.getWithMetadata.mockResolvedValue({
      data: 'stream-stub',
      metadata: { contentType: 'image/png' },
    });
    const res = await servePhotoHandler(serveReq, { params: { noteId: NOTE_ID, photoId: PHOTO_ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(state.store!.getWithMetadata).toHaveBeenCalledWith(`${NOTE_ID}/${PHOTO_ID}`, { type: 'stream' });
  });

  it('🔒 S2 malformed path params return 404 without touching the store', async () => {
    const res = await servePhotoHandler(serveReq, {
      params: { noteId: '../secrets', photoId: PHOTO_ID },
    });
    expect(res.status).toBe(404);
    expect(state.store!.getWithMetadata).not.toHaveBeenCalled();
  });

  it('❌ S3 a missing blob returns 404', async () => {
    state.store!.getWithMetadata.mockResolvedValue(null);
    const res = await servePhotoHandler(serveReq, { params: { noteId: NOTE_ID, photoId: PHOTO_ID } });
    expect(res.status).toBe(404);
  });

  it('⚠️ S4 missing metadata falls back to image/jpeg', async () => {
    state.store!.getWithMetadata.mockResolvedValue({ data: 'stream-stub', metadata: null });
    const res = await servePhotoHandler(serveReq, { params: { noteId: NOTE_ID, photoId: PHOTO_ID } });
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });
});

// ─── Phase: Markdown rendering gate ──────────────────────────────────────────

describe('Phase: Markdown rendering gate (.eleventy.js markdown filter)', () => {
  function loadFilters(): Record<string, (...args: unknown[]) => string> {
    const filters: Record<string, (...args: unknown[]) => string> = {};
    eleventyInit({
      addPassthroughCopy: () => {},
      addFilter: (name: string, fn: (...args: unknown[]) => string) => {
        filters[name] = fn;
      },
    });
    return filters;
  }

  it('🔒 R1 raw HTML/script in a note body is escaped, never executed', () => {
    const { markdown } = loadFilters();
    const out = markdown('Hello\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('✅ R2 renders bold, lists, and autolinked URLs', () => {
    const { markdown } = loadFilters();
    const out = markdown('**DARE UPDATE:**\n\n* item one\n\nVisit www.whofixedtheroof.com today');
    expect(out).toContain('<strong>DARE UPDATE:</strong>');
    expect(out).toContain('<li>item one</li>');
    expect(out).toMatch(/<a href="http:\/\/www\.whofixedtheroof\.com">/);
  });

  it('⚠️ R3 null/undefined body renders to an empty string', () => {
    const { markdown } = loadFilters();
    expect(markdown(null)).toBe('');
    expect(markdown(undefined)).toBe('');
  });
});
