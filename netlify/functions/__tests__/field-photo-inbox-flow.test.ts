import { beforeEach, describe, expect, it, vi } from 'vitest';

interface DbRoute {
  match: RegExp;
  rows: unknown[];
}

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_FILE_ID = '77777777-7777-4777-8777-777777777777';
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
import cleanupInboxHandler from '../cleanup-field-photo-inbox.mjs';
import inboundHandler from '../inbound-field-photos.mjs';

function onDb(match: RegExp, rows: unknown[]) {
  state.routes.push({ match, rows });
}

function receivedEvent(recipient = 'photos@inbound.example') {
  return {
    type: 'email.received',
    created_at: '2026-08-25T16:00:00.000Z',
    data: {
      email_id: EMAIL_ID,
      created_at: '2026-08-25T15:59:00.000Z',
      from: 'Taylor Volunteer <taylor@example.com>',
      to: [recipient],
      received_for: [recipient],
      bcc: [],
      cc: [],
      message_id: '<message@example.com>',
      subject: 'Augusta trip photos',
      attachments: [],
    },
  };
}

function webhookRequest() {
  return new Request('https://whofixedtheroof.com/api/inbound/field-photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_test',
      'svix-timestamp': '1787673600',
      'svix-signature': 'v1,test',
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

describe('Resend field photo ingestion', () => {
  it('rejects an invalid webhook before database or blob access', async () => {
    state.verify.mockImplementation(() => {
      throw new Error('bad signature');
    });

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(400);
    expect(state.getDatabase).not.toHaveBeenCalled();
    expect(state.inboxStore.set).not.toHaveBeenCalled();
  });

  it('ignores mail that was not sent to the configured inbox', async () => {
    state.verify.mockReturnValue(receivedEvent('somebody-else@inbound.example'));

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(state.getDatabase).not.toHaveBeenCalled();
  });

  it('stores sanitized derivatives and normalized EXIF attributes in quarantine', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    onDb(/INSERT INTO field_photo_submission_files/, [{ id: FILE_ID, status: 'processing' }]);

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, photos: 1 });
    expect(state.processFieldPhoto).toHaveBeenCalledWith(Buffer.from('original-image'));
    expect(state.inboxStore.set).toHaveBeenNthCalledWith(
      1,
      `${SUBMISSION_ID}/${FILE_ID}/image.jpg`,
      Buffer.from('sanitized-image'),
      { metadata: { contentType: 'image/jpeg' } }
    );
    expect(state.inboxStore.set).toHaveBeenNthCalledWith(
      2,
      `${SUBMISSION_ID}/${FILE_ID}/thumbnail.jpg`,
      Buffer.from('thumbnail'),
      { metadata: { contentType: 'image/jpeg' } }
    );
    const metadataUpdate = state.dbCalls.find((call) =>
      /UPDATE field_photo_submission_files SET content_type/.test(call.text)
    );
    expect(metadataUpdate?.values).toContain('2026-08-24');
    expect(metadataUpdate?.values).toContain(33.4735);
    expect(metadataUpdate?.values).toContain(-82.0105);
  });

  it('records HEIC attachments as unsupported without downloading them', async () => {
    onDb(/INSERT INTO field_photo_submissions/, [{ id: SUBMISSION_ID, status: 'processing' }]);
    state.receivingGet.mockResolvedValue({
      data: {
        attachments: [
          {
            id: ATTACHMENT_ID,
            filename: 'crew.heic',
            size: 2048,
            content_type: 'image/heic',
          },
        ],
      },
      error: null,
    });

    const response = await inboundHandler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, photos: 0 });
    expect(state.attachmentGet).not.toHaveBeenCalled();
    expect(state.processFieldPhoto).not.toHaveBeenCalled();
    const failedFileInsert = state.dbCalls.find((call) =>
      /INSERT INTO field_photo_submission_files/.test(call.text)
    );
    expect(failedFileInsert?.values).toContain('image/heic');
    expect(failedFileInsert?.values).toContain('The attachment is not a supported photo type.');
  });
});

describe('Coordinator Photo Inbox', () => {
  it('returns the coordinator denial before querying submissions', async () => {
    const denial = new Response(JSON.stringify({ error: 'Denied' }), { status: 403 });
    state.getCoordinatorSession.mockResolvedValue({ response: denial });

    const response = await adminInboxHandler(adminRequest());

    expect(response).toBe(denial);
    expect(state.sql).not.toHaveBeenCalled();
  });

  it('lists pending photos with a private coordinate grouping label', async () => {
    onDb(/SELECT \* FROM field_photo_submissions/, [
      {
        id: SUBMISSION_ID,
        status: 'ready',
        sender_email: 'taylor@example.com',
        received_at: '2026-08-25T15:59:00.000Z',
      },
    ]);
    onDb(/SELECT \* FROM field_photo_submission_files/, [
      {
        id: FILE_ID,
        submission_id: SUBMISSION_ID,
        status: 'ready',
        gps_latitude: 33.4735,
        gps_longitude: -82.0105,
      },
    ]);
    onDb(/SELECT id, title, status, start_date, end_date/, []);

    const response = await adminInboxHandler(adminRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.submissions[0].files[0].location_group).toBe('Near 33.47, -82.01');
    expect(body.inbox_address).toBe('photos@inbound.example');
  });

  it('validates the complete metadata batch before updating any photo', async () => {
    const response = await adminInboxHandler(
      adminRequest('PATCH', {
        submission_id: SUBMISSION_ID,
        files: [
          {
            id: FILE_ID,
            captured_date: '2026-08-24',
            location_label: 'Augusta, GA',
            alt: 'Roof repair crew',
          },
          {
            id: SECOND_FILE_ID,
            captured_date: '2026-02-31',
            location_label: 'Augusta, GA',
            alt: 'Completed repair',
          },
        ],
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Each photo needs a valid id and capture date.',
    });
    expect(state.dbCalls).toHaveLength(0);
  });

  it('promotes only selected sanitized photos into the existing Field Note store', async () => {
    onDb(/SELECT id, status FROM field_notes/, [{ id: NOTE_ID, status: 'draft' }]);
    onDb(/SELECT \* FROM field_photo_submission_files/, [
      {
        id: FILE_ID,
        submission_id: SUBMISSION_ID,
        status: 'ready',
        inbox_blob_key: `${SUBMISSION_ID}/${FILE_ID}/image.jpg`,
        captured_at_local: '2026-08-24T11:30:00',
        captured_offset_minutes: -240,
        captured_date: '2026-08-24',
        location_label: null,
        exif_subset: { captured_at_local: '2026-08-24T11:30:00' },
      },
    ]);
    onDb(/SELECT COALESCE\(MAX\(sort_order\)/, [{ max_order: -1 }]);
    onDb(/SELECT COUNT\(\*\)::INTEGER AS count/, [{ count: 0 }]);
    state.inboxStore.get.mockResolvedValue(Buffer.from('sanitized-image').buffer);

    const response = await adminInboxHandler(
      adminRequest('POST', {
        action: 'approve',
        submission_id: SUBMISSION_ID,
        note_id: NOTE_ID,
        files: [
          {
            id: FILE_ID,
            alt: 'Volunteers repairing a roof',
            captured_date: '2026-08-24',
            location_label: 'Augusta, GA',
            is_cover: true,
          },
        ],
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.approved).toHaveLength(1);
    expect(state.finalStore.set).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${NOTE_ID}/[0-9a-f-]+$`)),
      expect.any(ArrayBuffer),
      { metadata: { contentType: 'image/jpeg' } }
    );
    const publicPhotoInsert = state.dbCalls.find((call) =>
      /INSERT INTO field_note_photos/.test(call.text)
    );
    expect(publicPhotoInsert).toBeDefined();
    expect(publicPhotoInsert?.text).not.toContain('gps_latitude');
    expect(publicPhotoInsert?.text).not.toContain('gps_longitude');
    expect(state.dbCalls.some((call) => /SET is_cover = \(id = \$\)/.test(call.text))).toBe(true);
    expect(state.requireSameOrigin).toHaveBeenCalled();
  });
});

describe('Photo Inbox retention', () => {
  it('deletes expired private blobs and scrubs precise location metadata', async () => {
    onDb(/SELECT id FROM field_photo_submissions/, [{ id: SUBMISSION_ID }]);
    onDb(/SELECT inbox_blob_key, thumbnail_blob_key/, [
      {
        id: FILE_ID,
        inbox_blob_key: `${SUBMISSION_ID}/${FILE_ID}/image.jpg`,
        thumbnail_blob_key: `${SUBMISSION_ID}/${FILE_ID}/thumbnail.jpg`,
      },
    ]);

    await cleanupInboxHandler();

    const expiryQuery = state.dbCalls.find((call) =>
      /SELECT id FROM field_photo_submissions/.test(call.text)
    );
    expect(expiryQuery?.text).toContain('make_interval(days => $::INTEGER)');
    expect(expiryQuery?.values).toEqual([30]);
    expect(state.inboxStore.delete).toHaveBeenCalledTimes(2);
    expect(state.dbCalls.some((call) => /gps_latitude = NULL/.test(call.text))).toBe(true);
    expect(state.dbCalls.some((call) => /gps_longitude = NULL/.test(call.text))).toBe(true);
    expect(state.dbCalls.some((call) => /'expired'/.test(call.text))).toBe(true);
  });

  it('bounds blob deletion concurrency and inserts audit events in one query', async () => {
    onDb(/SELECT id FROM field_photo_submissions/, [{ id: SUBMISSION_ID }]);
    onDb(
      /SELECT inbox_blob_key, thumbnail_blob_key/,
      Array.from({ length: 30 }, (_, index) => ({
        id: `file-${index}`,
        inbox_blob_key: `${SUBMISSION_ID}/file-${index}/image.jpg`,
        thumbnail_blob_key: `${SUBMISSION_ID}/file-${index}/thumbnail.jpg`,
      }))
    );
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    state.inboxStore.delete.mockImplementation(async () => {
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      await Promise.resolve();
      activeDeletes -= 1;
    });

    await cleanupInboxHandler();

    expect(state.inboxStore.delete).toHaveBeenCalledTimes(60);
    expect(maxActiveDeletes).toBeLessThanOrEqual(25);
    const auditInserts = state.dbCalls.filter((call) =>
      /INSERT INTO field_photo_submission_events/.test(call.text)
    );
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].text).toContain('FROM UNNEST($::UUID[])');
    expect(auditInserts[0].values).toEqual([
      JSON.stringify({ retention_days: 30 }),
      [SUBMISSION_ID],
    ]);
  });

  it('retries an approved private blob after a failed deletion without rejecting it', async () => {
    const imageKey = `${SUBMISSION_ID}/${FILE_ID}/image.jpg`;
    const thumbnailKey = `${SUBMISSION_ID}/${FILE_ID}/thumbnail.jpg`;
    onDb(/WHERE status IN \('approved', 'rejected'\)/, [
      { id: FILE_ID, inbox_blob_key: imageKey, thumbnail_blob_key: thumbnailKey },
    ]);
    let imageAttempts = 0;
    state.inboxStore.delete.mockImplementation(async (key) => {
      if (key === imageKey && imageAttempts++ === 0) throw new Error('temporary delete failure');
    });

    await cleanupInboxHandler();

    expect(
      state.dbCalls.some(
        (call) => /SET inbox_blob_key = NULL/.test(call.text) && call.values.includes(imageKey)
      )
    ).toBe(false);
    expect(
      state.dbCalls.some(
        (call) =>
          /SET thumbnail_blob_key = NULL/.test(call.text) && call.values.includes(thumbnailKey)
      )
    ).toBe(true);
    expect(state.dbCalls.some((call) => /UPDATE field_photo_submissions/.test(call.text))).toBe(
      false
    );

    state.routes = [];
    onDb(/WHERE status IN \('approved', 'rejected'\)/, [
      { id: FILE_ID, inbox_blob_key: imageKey, thumbnail_blob_key: null },
    ]);
    await cleanupInboxHandler();

    expect(state.inboxStore.delete.mock.calls.filter(([key]) => key === imageKey)).toHaveLength(2);
    expect(state.inboxStore.delete.mock.calls.filter(([key]) => key === thumbnailKey)).toHaveLength(1);
    expect(
      state.dbCalls.some(
        (call) => /SET inbox_blob_key = NULL/.test(call.text) && call.values.includes(imageKey)
      )
    ).toBe(true);
    expect(state.dbCalls.some((call) => /UPDATE field_photo_submissions/.test(call.text))).toBe(
      false
    );
  });
});
