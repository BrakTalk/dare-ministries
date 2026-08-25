// Build-feed fallback contract tests, generated from the fieldNotesData() →
// /api/field-notes-feed → database sequence diagram.
// Spec: docs/field-notes-feed-seq-tests.md — covers only gaps not already
// pinned by field-notes-flow.test.ts (see the spec's exclusion table).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  dbCalls: [] as { text: string; values: unknown[] }[],
  dbRoutes: [] as { match: RegExp; handler: (values: unknown[]) => unknown[] }[],
}));

vi.mock('@netlify/database', () => ({
  getDatabase: () => ({
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ').trim();
      state.dbCalls.push({ text, values });
      for (const route of state.dbRoutes) {
        if (route.match.test(text)) return route.handler(values);
      }
      return [];
    },
  }),
}));

import fieldNotesData from '../../../src/_data/fieldNotes.js';
import feedHandler from '../field-notes-feed.mjs';

const NOTE_A = '11111111-1111-4111-8111-111111111111';
const NOTE_B = '22222222-2222-4222-8222-222222222222';
const PHOTO_1 = '33333333-3333-4333-8333-333333333333';
const PHOTO_2 = '44444444-4444-4444-8444-444444444444';
const PHOTO_3 = '55555555-5555-4555-8555-555555555555';

interface FeedPayload {
  notes?: unknown[];
  photos?: unknown[];
}

function noteRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    slug: `slug-${id.slice(0, 4)}`,
    title: 'Trip',
    start_date: '2026-07-16',
    end_date: '2026-07-18',
    body: 'Recap',
    published_at: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function stubFeed(payload: FeedPayload | 'invalid-json', status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (payload === 'invalid-json') throw new SyntaxError('Unexpected token < in JSON');
      return payload;
    },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function netlifyBuildEnv() {
  delete process.env.NETLIFY_DATABASE_URL;
  process.env.NETLIFY = 'true';
  process.env.URL = 'https://whofixedtheroof.com';
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  state.dbCalls.length = 0;
  state.dbRoutes.length = 0;
  for (const key of ['NETLIFY_DATABASE_URL', 'NETLIFY', 'URL']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ['NETLIFY_DATABASE_URL', 'NETLIFY', 'URL']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Phase: Source selection ─────────────────────────────────────────────────

describe('Phase: Source selection (fieldNotesData)', () => {
  it('⚠️ FS1 direct DB wins over the feed when both are available', async () => {
    netlifyBuildEnv();
    process.env.NETLIFY_DATABASE_URL = 'postgres://test';
    const fetchMock = stubFeed({ notes: [], photos: [] });
    state.dbRoutes.push({ match: /FROM field_notes WHERE status/, handler: () => [] });
    await expect(fieldNotesData()).resolves.toEqual([]);
    expect(state.dbCalls.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('⚠️ FS2 Netlify build with no URL warns and builds empty, no fetch', async () => {
    process.env.NETLIFY = 'true';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = stubFeed({ notes: [], photos: [] });
    await expect(fieldNotesData()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no database access'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('❌ FS3 a network-level fetch failure fails the build', async () => {
    netlifyBuildEnv();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
    }));
    await expect(fieldNotesData()).rejects.toThrow('fetch failed');
  });
});

// ─── Phase: Feed response contract ───────────────────────────────────────────

describe('Phase: Feed response contract', () => {
  it('❌ FC1 HTTP 200 with an unparsable body fails the build', async () => {
    netlifyBuildEnv();
    stubFeed('invalid-json');
    await expect(fieldNotesData()).rejects.toThrow();
  });

  it('❌ FC2 HTTP 200 missing the notes key fails the build', async () => {
    netlifyBuildEnv();
    stubFeed({});
    await expect(fieldNotesData()).rejects.toThrow();
  });

  it('❌ FC3 notes present but photos missing fails the build', async () => {
    netlifyBuildEnv();
    stubFeed({ notes: [noteRow(NOTE_A)] });
    await expect(fieldNotesData()).rejects.toThrow();
  });

  it('✅ FC4 photos are attributed to the correct notes in a multi-note payload', async () => {
    netlifyBuildEnv();
    stubFeed({
      notes: [noteRow(NOTE_A), noteRow(NOTE_B, { start_date: '2026-06-01', end_date: null })],
      photos: [
        { id: PHOTO_1, note_id: NOTE_A, alt: 'A1', is_cover: false },
        { id: PHOTO_2, note_id: NOTE_B, alt: 'B1', is_cover: true },
        { id: PHOTO_3, note_id: NOTE_A, alt: 'A2', is_cover: true },
      ],
    });
    const notes = await fieldNotesData();
    const a = notes.find((n: { id: string }) => n.id === NOTE_A);
    const b = notes.find((n: { id: string }) => n.id === NOTE_B);
    expect(a.photos.map((p: { alt: string }) => p.alt)).toEqual(['A1', 'A2']);
    expect(b.photos.map((p: { alt: string }) => p.alt)).toEqual(['B1']);
    expect(a.cover.url).toBe(`/images/field/${NOTE_A}/${PHOTO_3}`);
    expect(b.cover.url).toBe(`/images/field/${NOTE_B}/${PHOTO_2}`);
  });

  it('⚠️ FC5 foreign photos matching no note are dropped', async () => {
    netlifyBuildEnv();
    stubFeed({
      notes: [noteRow(NOTE_A)],
      photos: [
        { id: PHOTO_1, note_id: NOTE_A, alt: 'Mine', is_cover: false },
        { id: PHOTO_2, note_id: NOTE_B, alt: 'Orphan', is_cover: true },
      ],
    });
    const notes = await fieldNotesData();
    expect(notes[0].photos).toHaveLength(1);
    expect(notes[0].photos[0].alt).toBe('Mine');
    expect(notes[0].cover.alt).toBe('Mine');
  });
});

// ─── Phase: Shaping edge cases ───────────────────────────────────────────────

describe('Phase: Shaping edge cases', () => {
  it('⚠️ SH1 end_date equal to start_date renders a single date', async () => {
    netlifyBuildEnv();
    stubFeed({
      notes: [noteRow(NOTE_A, { start_date: '2026-07-16', end_date: '2026-07-16' })],
      photos: [],
    });
    const notes = await fieldNotesData();
    expect(notes[0].date_display).toBe('July 16, 2026');
  });

  it('⚠️ SH2 multiple is_cover photos resolve deterministically to the first', async () => {
    netlifyBuildEnv();
    stubFeed({
      notes: [noteRow(NOTE_A)],
      photos: [
        { id: PHOTO_1, note_id: NOTE_A, alt: 'First cover', is_cover: true },
        { id: PHOTO_2, note_id: NOTE_A, alt: 'Second cover', is_cover: true },
      ],
    });
    const notes = await fieldNotesData();
    expect(notes[0].cover.alt).toBe('First cover');
  });

  it('⚠️ SH3 null photo alt becomes an empty string, never "null"', async () => {
    netlifyBuildEnv();
    stubFeed({
      notes: [noteRow(NOTE_A)],
      photos: [{ id: PHOTO_1, note_id: NOTE_A, alt: null, is_cover: false }],
    });
    const notes = await fieldNotesData();
    expect(notes[0].photos[0].alt).toBe('');
  });
});

// ─── Phase: Feed function failure propagation ────────────────────────────────

describe('Phase: Feed function failure propagation', () => {
  it('❌ FF1 a database error inside the feed propagates, never a silent empty 200', async () => {
    state.dbRoutes.push({
      match: /FROM field_notes WHERE status/,
      handler: () => {
        throw new Error('connection refused');
      },
    });
    const req = new Request('http://localhost/api/field-notes-feed', { method: 'GET' });
    await expect(feedHandler(req)).rejects.toThrow('connection refused');
  });
});
