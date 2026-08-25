import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rosterTemplate = readFileSync(resolve(process.cwd(), 'src/roster.njk'), 'utf8');
const rosterSource = readFileSync(resolve(process.cwd(), 'src/js/roster.js'), 'utf8');
const rosterStyles = readFileSync(resolve(process.cwd(), 'src/css/roster.css'), 'utf8');

describe('coordinator Photo Inbox integration', () => {
  it('wires a counted Photo Inbox tab and private review panel into the roster', () => {
    expect(rosterTemplate).toContain('data-tab="photo-inbox"');
    expect(rosterTemplate).toContain('id="photoInboxCount"');
    expect(rosterTemplate).toContain('id="tab-photo-inbox"');
    expect(rosterTemplate).toContain('id="photoInboxList"');
  });

  it('loads, groups, saves, approves, and rejects through the protected inbox API', () => {
    expect(rosterSource).toContain("api('/api/admin/field-photo-inbox')");
    expect(rosterSource).toContain('function groupInboxFiles(files)');
    expect(rosterSource).toContain("action: 'approve'");
    expect(rosterSource).toContain("action: 'reject'");
    expect(rosterSource).toContain("method: 'PATCH'");
  });

  it('labels approximate EXIF locations as private suggestions, not public values', () => {
    expect(rosterSource).toContain(
      "file.location_label || file.location_group || 'Location unknown'"
    );
    expect(rosterTemplate).toContain('only coordinator-reviewed values leave the inbox');
    expect(rosterSource).toContain('placeholder="${esc(file.location_group');
  });

  it('includes responsive thumbnail, field, and action layouts', () => {
    expect(rosterStyles).toContain('.photo-inbox-grid');
    expect(rosterStyles).toContain('.photo-inbox-file-fields');
    expect(rosterStyles).toContain('.photo-inbox-actions');
    expect(rosterStyles).toContain('@media (max-width: 700px)');
  });
});
