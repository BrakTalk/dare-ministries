import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface DbRoute {
  match: RegExp;
  rows: unknown[];
}

interface ApprovalFileInput {
  id: string;
  alt?: string;
  captured_date?: string | null;
  location_label?: string;
  is_cover?: boolean;
}

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const NOTE_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const EMAIL_ID = '55555555-5555-4555-8555-555555555555';
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666';

const state = vi.hoisted(() => ({
  dbCalls: [] as { text: string; values: unknown[] }[],
  routes: [] as DbRoute[],
  sql: vi.fn(),
  getDatabase: vi.fn(),
  getCoordinatorSession: vi.fn(),
  requireSameOrigin: vi.fn(),
  verify: vi.fn(),
  receivingGet: vi.fn(),
  attachmentGet: vi.fn(),
  processFieldPhoto: vi.fn(),
  inboxStore: {
    set: vi.fn(),
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    delete: vi.fn(),
  },
  finalStore: {
    set: vi.fn(),
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@netlify/database', () => ({ getDatabase: state.getDatabase }));
vi.mock('@netlify/blobs', () => ({
  getStore: (name: string) => (name === 'field-photos' ? state.finalStore : state.inboxStore),
}));
vi.mock('resend', () => ({
  Resend: class {
    webhooks = { verify: (...args: unknown[]) => state.verify(...args) };
    emails = {
      receiving: {
        get: (...args: unknown[]) => state.receivingGet(...args),
        attachments: { get: (...args: unknown[]) => state.attachmentGet(...args) },
      },
    };
  },
}));
vi.mock('../lib/field-photo-processing.mjs', () => ({
  MAX_INBOX_IMAGE_BYTES: 15 * 1024 * 1024,
  processFieldPhoto: (...args: unknown[]) => state.processFieldPhoto(...args),
  coordinateGroupLabel: (latitude: unknown, longitude: unknown) => {
    const lat = Number(latitude);
    const lon = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? `Near ${lat.toFixed(2)}, ${lon.toFixed(2)}`
      : null;
  },
}));
vi.mock('../lib/auth.mjs', () => ({ getCoordinatorSession: state.getCoordinatorSession }));
vi.mock('../lib/portal-auth.mjs', () => ({ requireSameOrigin: state.requireSameOrigin }));

import adminInboxHandler from '../admin-field-photo-inbox.mjs';
import inboundHandler from '../inbound-field-photos.mjs';

function onDb(match: RegExp, rows: unknown[]) {
  state.routes.push({ match, rows });
}

function receivedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'email.received',
    created_at: '2026-08-25T16:00:00.000Z',
    data: {
      email_id: EMAIL_ID,
      created_at: '2026-08-25T15:59:00.000Z',
      from: 'Taylor Volunteer <taylor@example.com>',
      to: ['photos@inbound.example'],
      received_for: ['photos@inbound.example'],
      subject: 'Augusta trip photos',
      ...overrides,
    },
  };
}

function webhookRequest(headers: Record<string, string> = {}) {
  return new Request('https://whofixedtheroof.com/api/inbound/field-photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_test',
      'svix-timestamp': '1787673600',
      'svix-signature': 'v1,test',
      ...headers,
    },
    body: JSON.stringify({ type: 'email.received' }),
  });
}

function adminRequest(method = 'GET', body?: unknown) {
  return new Request('https://whofixedtheroof.com/api/admin/field-photo-inbox', {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' ? {} : { Origin: 'https://whofixedtheroof.com' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function readyInboxFile(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    submission_id: SUBMISSION_ID,
    status: 'ready',
    inbox_blob_key: `${SUBMISSION_ID}/${FILE_ID}/image.jpg`,
    thumbnail_blob_key: `${SUBMISSION_ID}/${FILE_ID}/thumbnail.jpg`,
    captured_at_local: '2026-08-24T11:30:00',
    captured_offset_minutes: -240,
    captured_date: '2026-08-24',
    location_label: null,
    gps_latitude: 33.4735,
    gps_longitude: -82.0105,
    exif_subset: { captured_at_local: '2026-08-24T11:30:00' },
    ...overrides,
  };
}

function approvalBody(files: ApprovalFileInput[] = [{ id: FILE_ID }]) {
  return {
    action: 'approve',
    submission_id: SUBMISSION_ID,
    note_id: NOTE_ID,
    files: files.map((file) => ({
      alt: 'Volunteers repairing a roof',
      captured_date: '2026-08-24',
      location_label: 'Augusta, GA',
      is_cover: false,
      ...file,
    })),
  };
}

function configureApproval(noteStatus = 'draft', files = [readyInboxFile()], remaining = 0) {
  onDb(/SELECT id, status FROM field_notes/, [{ id: NOTE_ID, status: noteStatus }]);
  onDb(/SELECT \* FROM field_photo_submission_files/, files);
  onDb(/SELECT COALESCE\(MAX\(sort_order\)/, [{ max_order: -1 }]);
  onDb(/SELECT COUNT\(\*\)::INTEGER AS count/, [{ count: remaining }]);
}

function failedFileCall() {
  return state.dbCalls
    .filter((call) => /INSERT INTO field_photo_submission_files/.test(call.text))
    .at(-1);
}

beforeEach(() => {
  state.dbCalls = [];
  state.routes = [];
  state.sql.mockReset();
  state.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim();
    state.dbCalls.push({ text, values });
    return state.routes.find((route) => route.match.test(text))?.rows || [];
  });
  state.getDatabase.mockReset();
  state.getDatabase.mockReturnValue({ sql: state.sql });
  state.getCoordinatorSession.mockReset();
  state.getCoordinatorSession.mockResolvedValue({
    profile: { id: PROFILE_ID, status: 'active', role: 'coordinator' },
    db: { sql: state.sql },
  });
  state.requireSameOrigin.mockReset();
  state.requireSameOrigin.mockReturnValue(null);
  state.verify.mockReset();
  state.verify.mockReturnValue(receivedEvent());
  state.receivingGet.mockReset();
  state.receivingGet.mockResolvedValue({
    data: {
      attachments: [
        {
          id: ATTACHMENT_ID,
          filename: 'crew.jpg',
          size: 2048,
          content_type: 'image/jpeg',
        },
      ],
    },
    error: null,
  });
  state.attachmentGet.mockReset();
  state.attachmentGet.mockResolvedValue({
    data: {
      id: ATTACHMENT_ID,
      size: 2048,
      content_type: 'image/jpeg',
      download_url: `https://inbound-cdn.resend.com/${EMAIL_ID}/attachments/${ATTACHMENT_ID}?signature=test`,
    },
    error: null,
  });
  state.processFieldPhoto.mockReset();
  state.processFieldPhoto.mockResolvedValue({
    image: Buffer.from('sanitized-image'),
    thumbnail: Buffer.from('thumbnail'),
    contentType: 'image/jpeg',
    byteSize: 15,
    width: 1600,
    height: 900,
    sha256: 'a'.repeat(64),
    capturedAtLocal: '2026-08-24T11:30:00',
    capturedOffsetMinutes: -240,
    capturedDate: '2026-08-24',
    gpsLatitude: 33.4735,
    gpsLongitude: -82.0105,
    exifSubset: { captured_at_local: '2026-08-24T11:30:00' },
  });
  for (const store of [state.inboxStore, state.finalStore]) {
    Object.values(store).forEach((mock) => mock.mockReset());
    store.set.mockResolvedValue({});
    store.delete.mockResolvedValue(undefined);
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(Buffer.from('original-image'), {
        status: 200,
        headers: { 'Content-Length': '14', 'Content-Type': 'image/jpeg' },
      })
    )
  );
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_test';
  process.env.FIELD_PHOTO_INBOX_RECIPIENTS = 'photos@inbound.example';
  delete process.env.FIELD_PHOTO_ALLOWED_SENDERS;
  delete process.env.BUILD_HOOK_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Phase: Webhook authentication and admission', () => {
  it('❌ FP-IN-01 rejects unsupported HTTP methods before initialization', async () => {
    delete process.env.RESEND_API_KEY;
    const response = await inboundHandler(
      new Request('https://whofixedtheroof.com/api/inbound/field-photos', { method: 'GET' })
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed.' });
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.getDatabase).not.toHaveBeenCalled();
  });

  it('❌ FP-IN-02 fails closed when intake configuration is incomplete', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(503);
    expect(errorLog).toHaveBeenCalledWith(
      'Field photo intake is missing Resend or recipient configuration.'
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('re_test');
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.getDatabase).not.toHaveBeenCalled();
  });

  it('🔒 FP-IN-03 rejects missing signature headers', async () => {
    const request = new Request('https://whofixedtheroof.com/api/inbound/field-photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const response = await inboundHandler(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing webhook signature.' });
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.getDatabase).not.toHaveBeenCalled();
  });

  it('🔒 FP-IN-04 enforces the optional sender allowlist without exposing policy', async () => {
    process.env.FIELD_PHOTO_ALLOWED_SENDERS = 'approved@example.com';

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(state.getDatabase).not.toHaveBeenCalled();
    expect(state.receivingGet).not.toHaveBeenCalled();
  });

  it('⚠️ FP-IN-05 treats a terminal webhook replay as an idempotent no-op', async () => {
    onDb(/INSERT INTO field_photo_submissions/, []);
    onDb(/SELECT id, status FROM field_photo_submissions/, [
      { id: SUBMISSION_ID, status: 'ready' },
    ]);

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(state.receivingGet).not.toHaveBeenCalled();
    expect(state.attachmentGet).not.toHaveBeenCalled();
    expect(state.inboxStore.set).not.toHaveBeenCalled();
  });
});

describe('Phase: Email and attachment acquisition', () => {
  it('⚠️ FP-ACQ-01 closes an email with no attachments as no photos', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    state.receivingGet.mockResolvedValue({ data: { attachments: [] }, error: null });

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, photos: 0 });
    expect(
      state.dbCalls.some(
        (call) => /UPDATE field_photo_submissions SET status = 'no_photos'/.test(call.text)
      )
    ).toBe(true);
    expect(state.processFieldPhoto).not.toHaveBeenCalled();
    expect(state.inboxStore.set).not.toHaveBeenCalled();
  });

  it('🔒 FP-ACQ-02 rejects more than twelve attachments before file processing', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    state.receivingGet.mockResolvedValue({
      data: {
        attachments: Array.from({ length: 13 }, (_, index) => ({
          id: `attachment-${index}`,
          filename: `photo-${index}.jpg`,
          size: 1,
          content_type: 'image/jpeg',
        })),
      },
      error: null,
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(inboundHandler(webhookRequest())).rejects.toThrow('more than 12 attachments');

    expect(errorLog).toHaveBeenCalledWith(
      'Field photo intake failed:',
      SUBMISSION_ID,
      'The email contains more than 12 attachments.'
    );
    expect(state.attachmentGet).not.toHaveBeenCalled();
    expect(state.inboxStore.set).not.toHaveBeenCalled();
  });

  it('🔒 FP-ACQ-03 rejects a declared attachment total over 40 MB', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    state.receivingGet.mockResolvedValue({
      data: {
        attachments: [
          { id: 'one', filename: 'one.jpg', size: 21 * 1024 * 1024, content_type: 'image/jpeg' },
          { id: 'two', filename: 'two.jpg', size: 20 * 1024 * 1024, content_type: 'image/jpeg' },
        ],
      },
      error: null,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(inboundHandler(webhookRequest())).rejects.toThrow('40 MB intake limit');

    expect(state.attachmentGet).not.toHaveBeenCalled();
    expect(state.processFieldPhoto).not.toHaveBeenCalled();
    expect(state.inboxStore.set).not.toHaveBeenCalled();
  });

  it('🔒 FP-ACQ-04 refuses attachment downloads from an unexpected host', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    onDb(/INSERT INTO field_photo_submission_files/, [{ id: FILE_ID, status: 'processing' }]);
    state.attachmentGet.mockResolvedValue({
      data: {
        id: ATTACHMENT_ID,
        size: 2048,
        download_url: 'https://attacker.example/roof.jpg',
      },
      error: null,
    });

    const response = await inboundHandler(webhookRequest());

    expect(await response.json()).toEqual({ ok: true, photos: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(state.processFieldPhoto).not.toHaveBeenCalled();
    expect(failedFileCall()?.values).toContain('Resend returned an unexpected attachment host.');
  });

  it('🔒 FP-ACQ-05 rejects an oversized attachment before download', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    onDb(/INSERT INTO field_photo_submission_files/, [{ id: FILE_ID, status: 'processing' }]);
    state.attachmentGet.mockResolvedValue({
      data: {
        id: ATTACHMENT_ID,
        size: 15 * 1024 * 1024 + 1,
        download_url: `https://inbound-cdn.resend.com/${EMAIL_ID}/attachments/${ATTACHMENT_ID}`,
      },
      error: null,
    });

    const response = await inboundHandler(webhookRequest());

    expect(await response.json()).toEqual({ ok: true, photos: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(state.processFieldPhoto).not.toHaveBeenCalled();
    expect(failedFileCall()?.values).toContain(
      'The attachment is larger than the 15 MB intake limit.'
    );
  });
});

describe('Phase: Image normalization and private storage', () => {
  it('❌ FP-PROC-02 preserves successful files when another attachment fails', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    onDb(/INSERT INTO field_photo_submission_files/, [{ id: FILE_ID, status: 'processing' }]);
    state.receivingGet.mockResolvedValue({
      data: {
        attachments: [
          { id: 'first', filename: 'notes.txt', size: 512, content_type: 'text/plain' },
          { id: 'second', filename: 'second.jpg', size: 512, content_type: 'image/jpeg' },
        ],
      },
      error: null,
    });
    state.processFieldPhoto
      .mockResolvedValueOnce({
        image: Buffer.from('sanitized-image'),
        thumbnail: Buffer.from('thumbnail'),
        contentType: 'image/jpeg',
        byteSize: 15,
        width: 1600,
        height: 900,
        sha256: 'a'.repeat(64),
        capturedAtLocal: null,
        capturedOffsetMinutes: null,
        capturedDate: null,
        gpsLatitude: null,
        gpsLongitude: null,
        exifSubset: {},
      });

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, photos: 1 });
    expect(state.processFieldPhoto).toHaveBeenCalledTimes(1);
    expect(state.inboxStore.set).toHaveBeenCalledTimes(2);
    expect(
      state.dbCalls.some((call) =>
        call.values.includes('The attachment is not a supported photo type.')
      )
    ).toBe(true);
    expect(
      state.dbCalls.some(
        (call) => /UPDATE field_photo_submissions SET status = \$/.test(call.text) && call.values.includes('partial')
      )
    ).toBe(true);
    const processedEvent = state.dbCalls.find((call) =>
      /INSERT INTO field_photo_submission_events/.test(call.text)
    );
    expect(processedEvent?.values).toContain(
      JSON.stringify({ attachments: 2, ready: 1, status: 'partial' })
    );
  });

  it('❌ FP-PROC-03 rolls back the full-size derivative when thumbnail storage fails', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    onDb(/INSERT INTO field_photo_submission_files/, [{ id: FILE_ID, status: 'processing' }]);
    state.inboxStore.set.mockReset();
    state.inboxStore.set
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('thumbnail storage unavailable'));

    const response = await inboundHandler(webhookRequest());

    expect(await response.json()).toEqual({ ok: true, photos: 0 });
    expect(state.inboxStore.delete).toHaveBeenCalledWith(`${SUBMISSION_ID}/${FILE_ID}/image.jpg`);
    expect(failedFileCall()?.values).toContain('thumbnail storage unavailable');
    expect(
      state.dbCalls.some((call) => /SET status = \$/.test(call.text) && call.values.includes('failed'))
    ).toBe(true);
  });

  it('⚠️ FP-PROC-04 resumes without redownloading an already-ready attachment', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    onDb(/INSERT INTO field_photo_submission_files/, [{ id: FILE_ID, status: 'ready' }]);

    const response = await inboundHandler(webhookRequest());

    expect(await response.json()).toEqual({ ok: true, photos: 1 });
    expect(state.attachmentGet).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.processFieldPhoto).not.toHaveBeenCalled();
    expect(state.inboxStore.set).not.toHaveBeenCalled();
  });
});

describe('Phase: Coordinator private inbox and previews', () => {
  it('🔒 FP-ADM-01 rejects malformed preview identifiers before storage access', async () => {
    const response = await adminInboxHandler(
      new Request(
        'https://whofixedtheroof.com/api/admin/field-photo-inbox?file_id=../../secret'
      )
    );

    expect(response.status).toBe(404);
    expect(state.sql).not.toHaveBeenCalled();
    expect(state.inboxStore.getWithMetadata).not.toHaveBeenCalled();
  });

  it('🔒 FP-ADM-02 serves authorized previews with private non-sniffable headers', async () => {
    onDb(/SELECT inbox_blob_key, thumbnail_blob_key/, [readyInboxFile()]);
    state.inboxStore.getWithMetadata.mockResolvedValue({
      data: Buffer.from('private-image'),
      metadata: { contentType: 'image/jpeg' },
    });

    const response = await adminInboxHandler(
      new Request(
        `https://whofixedtheroof.com/api/admin/field-photo-inbox?file_id=${FILE_ID}&variant=image`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('private-image');
  });

  it('🔒 FP-ADM-03 blocks cross-origin mutations before database writes', async () => {
    const denial = new Response(JSON.stringify({ error: 'Request origin is not allowed.' }), {
      status: 403,
    });
    state.requireSameOrigin.mockReturnValue(denial);

    const response = await adminInboxHandler(adminRequest('POST', approvalBody()));

    expect(response).toBe(denial);
    expect(state.sql).not.toHaveBeenCalled();
    expect(state.inboxStore.get).not.toHaveBeenCalled();
    expect(state.finalStore.set).not.toHaveBeenCalled();
  });

  it('❌ FP-ADM-04 rejects malformed JSON without state mutation', async () => {
    const response = await adminInboxHandler(
      new Request('https://whofixedtheroof.com/api/admin/field-photo-inbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://whofixedtheroof.com',
        },
        body: '{invalid',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request body.' });
    expect(state.sql).not.toHaveBeenCalled();
    expect(state.finalStore.set).not.toHaveBeenCalled();
  });
});

describe('Phase: Approval and publication', () => {
  it('❌ FP-ADM-05 rejects approval to a nonexistent Field Note', async () => {
    onDb(/SELECT id, status FROM field_notes/, []);

    const response = await adminInboxHandler(adminRequest('POST', approvalBody()));

    expect(response.status).toBe(404);
    expect(state.inboxStore.get).not.toHaveBeenCalled();
    expect(state.finalStore.set).not.toHaveBeenCalled();
  });

  it('⚠️ FP-ADM-06 rejects unavailable selected files as one batch', async () => {
    onDb(/SELECT id, status FROM field_notes/, [{ id: NOTE_ID, status: 'draft' }]);
    onDb(/SELECT \* FROM field_photo_submission_files/, []);

    const response = await adminInboxHandler(adminRequest('POST', approvalBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'One or more selected photos are unavailable.' });
    expect(state.inboxStore.get).not.toHaveBeenCalled();
    expect(state.finalStore.set).not.toHaveBeenCalled();
  });

  it('❌ FP-ADM-07 rejects approval when the private derivative is missing', async () => {
    configureApproval();
    state.inboxStore.get.mockResolvedValue(null);

    const response = await adminInboxHandler(adminRequest('POST', approvalBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A selected photo is no longer available.' });
    expect(state.finalStore.set).not.toHaveBeenCalled();
    expect(state.dbCalls.some((call) => /INSERT INTO field_note_photos/.test(call.text))).toBe(false);
  });

  it('❌ FP-ADM-08 removes a copied public Blob when its database insert fails', async () => {
    state.sql
      .mockResolvedValueOnce([{ id: NOTE_ID, status: 'draft' }])
      .mockResolvedValueOnce([readyInboxFile()])
      .mockResolvedValueOnce([{ max_order: -1 }])
      .mockRejectedValueOnce(new Error('database insert failed'));
    state.inboxStore.get.mockResolvedValue(Buffer.from('sanitized-image').buffer);

    await expect(
      adminInboxHandler(adminRequest('POST', approvalBody()))
    ).rejects.toThrow('database insert failed');

    const publicKey = state.finalStore.set.mock.calls[0]?.[0];
    expect(publicKey).toEqual(expect.stringMatching(new RegExp(`^${NOTE_ID}/[0-9a-f-]+$`)));
    expect(state.finalStore.delete).toHaveBeenCalledWith(publicKey);
  });

  it('⚠️ FP-ADM-09 retains private keys when post-approval deletion fails', async () => {
    configureApproval();
    state.inboxStore.get.mockResolvedValue(Buffer.from('sanitized-image').buffer);
    state.inboxStore.delete.mockRejectedValue(new Error('private delete unavailable'));

    const response = await adminInboxHandler(adminRequest('POST', approvalBody()));

    expect(response.status).toBe(200);
    expect((await response.json()).approved).toHaveLength(1);
    expect(state.inboxStore.delete).toHaveBeenCalledTimes(2);
    expect(
      state.dbCalls.some((call) => /SET inbox_blob_key = NULL, thumbnail_blob_key = NULL/.test(call.text))
    ).toBe(false);
    expect(
      state.dbCalls.some(
        (call) => /status = 'approved'/.test(call.text) && /gps_latitude = NULL/.test(call.text)
      )
    ).toBe(true);
  });

  it('🔒 FP-ADM-10 rejects a submission and scrubs private location data', async () => {
    onDb(/SELECT id FROM field_photo_submissions/, [{ id: SUBMISSION_ID }]);
    onDb(/SELECT inbox_blob_key, thumbnail_blob_key/, [readyInboxFile()]);

    const response = await adminInboxHandler(
      adminRequest('POST', { action: 'reject', submission_id: SUBMISSION_ID })
    );

    expect(response.status).toBe(200);
    expect(state.inboxStore.delete).toHaveBeenCalledWith(
      `${SUBMISSION_ID}/${FILE_ID}/image.jpg`
    );
    expect(state.inboxStore.delete).toHaveBeenCalledWith(
      `${SUBMISSION_ID}/${FILE_ID}/thumbnail.jpg`
    );
    expect(
      state.dbCalls.some(
        (call) => /gps_latitude = CASE/.test(call.text) && /gps_longitude = CASE/.test(call.text)
      )
    ).toBe(true);
    const audit = state.dbCalls.find((call) => /field_photo_submission_events/.test(call.text));
    expect(audit?.values).toContain(PROFILE_ID);
    expect(audit?.text).toContain("'rejected'");
  });

  it('✅ FP-ADM-11 triggers a rebuild after approval into a published Field Note', async () => {
    configureApproval('published');
    state.inboxStore.get.mockResolvedValue(Buffer.from('sanitized-image').buffer);
    process.env.BUILD_HOOK_URL = 'https://api.netlify.com/build_hooks/test';

    const response = await adminInboxHandler(adminRequest('POST', approvalBody()));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith('https://api.netlify.com/build_hooks/test', {
      method: 'POST',
    });
  });
});

describe('Phase: Cross-cutting replay and concurrency guards', () => {
  it('⚠️ FP-X-01 rejects duplicate file IDs in one approval selection', async () => {
    onDb(/SELECT id, status FROM field_notes/, [{ id: NOTE_ID, status: 'draft' }]);
    onDb(/SELECT \* FROM field_photo_submission_files/, [readyInboxFile()]);

    const response = await adminInboxHandler(
      adminRequest('POST', approvalBody([{ id: FILE_ID }, { id: FILE_ID, is_cover: true }]))
    );

    expect(response.status).toBe(409);
    expect(state.inboxStore.get).not.toHaveBeenCalled();
    expect(state.finalStore.set).not.toHaveBeenCalled();
  });
});
