/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rosterSource = readFileSync(resolve(here, '../roster.js'), 'utf8');
const executableRosterSource = rosterSource.replace(
  /import\s*\{\s*logout\s*\}\s*from\s*['"]\/js\/vendor\/netlify-identity\.js['"];?\s*/,
  ''
);
const rosterMarkup = (() => {
  const html = readFileSync(resolve(here, '../../roster.njk'), 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!body) throw new Error('roster.njk: could not extract <body>');
  return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const FILE_IDS = [
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332',
  '33333333-3333-4333-8333-333333333333',
];

interface LoggedRequest {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

let fetchLog: LoggedRequest[] = [];
let mockLogout: ReturnType<typeof vi.fn>;

function inboxResponse() {
  return {
    configured: true,
    inbox_address: 'photos@whofixedtheroof.com',
    notes: [{ id: NOTE_ID, title: 'Augusta Roof Repair', status: 'draft' }],
    submissions: [
      {
        id: SUBMISSION_ID,
        subject: 'Augusta trip photos',
        sender_name: 'Taylor Volunteer',
        sender_email: 'taylor@example.com',
        status: 'ready',
        received_at: '2026-08-25T15:59:00.000Z',
        files: [
          {
            id: FILE_IDS[0],
            status: 'ready',
            original_filename: 'roof-before.jpg',
            captured_date: '2026-08-24',
            location_label: null,
            location_group: 'Near 33.47, -82.01',
            alt: '',
            thumbnail_url: '/thumb-before',
            preview_url: '/preview-before',
          },
          {
            id: FILE_IDS[1],
            status: 'ready',
            original_filename: 'roof-after.jpg',
            captured_date: '2026-08-24',
            location_label: null,
            location_group: 'Near 33.47, -82.01',
            alt: 'Completed roof',
            thumbnail_url: '/thumb-after',
            preview_url: '/preview-after',
          },
          {
            id: FILE_IDS[2],
            status: 'ready',
            original_filename: 'crew.jpg',
            captured_date: null,
            location_label: null,
            location_group: null,
            alt: 'Volunteer crew',
            thumbnail_url: '/thumb-crew',
            preview_url: '/preview-crew',
          },
        ],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockFetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  fetchLog.push({ url, method, body });

  if (url.startsWith('/api/admin/session')) {
    return jsonResponse({
      authenticated: true,
      profile: { status: 'active', role: 'coordinator' },
    });
  }
  if (url.startsWith('/api/admin/volunteers')) return jsonResponse([]);
  if (url.startsWith('/api/admin/contacts')) return jsonResponse([]);
  if (url.startsWith('/api/impact-stats')) return jsonResponse({});
  if (url.startsWith('/api/admin/field-notes')) {
    return jsonResponse([
      {
        id: NOTE_ID,
        title: 'Augusta Roof Repair',
        status: 'draft',
        start_date: '2026-08-24',
        end_date: null,
        body: '',
        photos: [],
      },
    ]);
  }
  if (url.startsWith('/api/admin/field-photo-inbox')) {
    return method === 'GET' ? jsonResponse(inboxResponse()) : jsonResponse({ ok: true });
  }
  return jsonResponse({ error: `Unrouted ${method} ${url}` }, 404);
});

async function flush() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

const documentListeners: Array<Parameters<Document['addEventListener']>> = [];

async function boot() {
  document.body.innerHTML = rosterMarkup;
  const nativeAdd = document.addEventListener.bind(document);
  const addSpy = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((...args: Parameters<Document['addEventListener']>) => {
      documentListeners.push(args);
      nativeAdd(...args);
    });
  try {
    new Function('logout', executableRosterSource)(mockLogout);
  } finally {
    addSpy.mockRestore();
  }
  await flush();
}

function writeRequests(method: string) {
  return fetchLog.filter(
    (request) =>
      request.url.startsWith('/api/admin/field-photo-inbox') && request.method === method
  );
}

beforeEach(() => {
  fetchLog = [];
  mockLogout = vi.fn(async () => undefined);
  window.history.replaceState(null, '', '/roster/');
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  );
});

afterEach(() => {
  for (const [type, listener, options] of documentListeners) {
    document.removeEventListener(type, listener, options);
  }
  documentListeners.length = 0;
  vi.unstubAllGlobals();
});

describe('coordinator Photo Inbox integration', () => {
  it('groups ready photos by capture date and private location suggestion', async () => {
    await boot();

    const groups = Array.from(document.querySelectorAll<HTMLElement>('.photo-inbox-group'));
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain('August 24, 2026');
    expect(groups[0].textContent).toContain('Near 33.47, -82.01');
    expect(groups[0].querySelectorAll('.photo-inbox-file')).toHaveLength(2);
    expect(groups[1].textContent).toContain('Capture date unknown');
    expect(groups[1].textContent).toContain('Location unknown');
    expect(document.querySelector('.photo-inbox-intro')?.textContent).toContain(
      'only coordinator-reviewed values leave the inbox'
    );
    expect(
      document.querySelector<HTMLInputElement>(
        `[data-file-id="${FILE_IDS[0]}"] [data-field="location"]`
      )?.placeholder
    ).toBe('Near 33.47, -82.01');
  });

  it('saves edited photo details with a PATCH request', async () => {
    await boot();
    const card = document.querySelector<HTMLElement>('.photo-inbox-card')!;
    const firstFile = card.querySelector<HTMLElement>(`[data-file-id="${FILE_IDS[0]}"]`)!;
    firstFile.querySelector<HTMLInputElement>('[data-field="alt"]')!.value =
      'Volunteers repairing the roof';
    firstFile.querySelector<HTMLInputElement>('[data-field="captured-date"]')!.value =
      '2026-08-25';
    firstFile.querySelector<HTMLInputElement>('[data-field="location"]')!.value = 'Augusta, GA';

    card.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    await flush();

    const writes = writeRequests('PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0].body?.submission_id).toBe(SUBMISSION_ID);
    const files = writes[0].body?.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({
      id: FILE_IDS[0],
      alt: 'Volunteers repairing the roof',
      captured_date: '2026-08-25',
      location_label: 'Augusta, GA',
      is_cover: false,
    });
  });

  it('approves selected photos and rejects an email with POST action payloads', async () => {
    await boot();
    let card = document.querySelector<HTMLElement>('.photo-inbox-card')!;
    card.querySelector<HTMLSelectElement>('[data-field="note"]')!.value = NOTE_ID;
    const fileCards = Array.from(card.querySelectorAll<HTMLElement>('[data-file-id]'));
    fileCards[1].querySelector<HTMLInputElement>('[data-field="selected"]')!.checked = false;
    fileCards[2].querySelector<HTMLInputElement>('[data-field="selected"]')!.checked = false;
    fileCards[0].querySelector<HTMLInputElement>('[data-field="cover"]')!.checked = true;

    card.querySelector<HTMLButtonElement>('[data-action="approve"]')!.click();
    await flush();

    const approve = writeRequests('POST').find(
      (request) => request.body?.action === 'approve'
    );
    expect(approve?.body).toEqual({
      action: 'approve',
      submission_id: SUBMISSION_ID,
      note_id: NOTE_ID,
      files: [
        {
          id: FILE_IDS[0],
          alt: '',
          captured_date: '2026-08-24',
          location_label: '',
          is_cover: true,
        },
      ],
    });

    card = document.querySelector<HTMLElement>('.photo-inbox-card')!;
    card.querySelector<HTMLButtonElement>('[data-action="reject"]')!.click();
    await flush();

    const reject = writeRequests('POST').find((request) => request.body?.action === 'reject');
    expect(reject?.body).toEqual({ action: 'reject', submission_id: SUBMISSION_ID });
  });
});
