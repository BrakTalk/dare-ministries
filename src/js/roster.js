// D.A.R.E. Ministries — Roster Admin Console
// Talks to the /api/admin/* Netlify Functions. Auth is a signed HttpOnly
// session cookie; every response is checked for 401 so an expired session
// drops back to the login view.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let volunteers = [];
  let contacts = [];
  let sortKey = 'created_at';
  let sortDir = 'desc';
  let currentDetail = null;

  // ─── API helper ─────────────────────────────────────────────────────────────

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Not authenticated');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed (' + res.status + ')');
    }
    return res.json();
  }

  // Escapes for BOTH text and quoted-attribute contexts: the textContent
  // round-trip covers & < >, but not quotes — without the replacements a
  // value like `" onmouseover="…` could break out of an attribute.
  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  let toastTimer = null;

  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // ─── Views ──────────────────────────────────────────────────────────────────

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('consoleView').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
  }

  // Loads panels independently — one failing panel must not read as an auth
  // failure or block the others. Session expiry is handled inside api() (401
  // drops back to the login view), so this function never throws.
  async function showConsole() {
    $('loginView').classList.add('hidden');
    $('consoleView').classList.remove('hidden');
    $('logoutBtn').classList.remove('hidden');

    const panels = [
      { load: loadVolunteers, emptyEl: 'volunteerEmpty' },
      { load: loadContacts, emptyEl: 'contactEmpty' },
      { load: loadStats, emptyEl: null },
      { load: loadFieldNotes, emptyEl: 'noteEmpty' },
    ];
    const results = await Promise.allSettled(panels.map((p) => p.load()));
    results.forEach((result, i) => {
      if (result.status !== 'rejected') return;
      console.error('Panel failed to load:', result.reason);
      const el = panels[i].emptyEl && $(panels[i].emptyEl);
      if (el) {
        el.textContent = 'Could not load — refresh to try again.';
        el.classList.remove('hidden');
      }
    });
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('loginError').classList.add('hidden');
    const btn = this.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    // Only the login request itself may trigger the password error —
    // post-auth data loading has its own error handling in showConsole().
    let loggedIn = false;
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('password').value }),
      });
      loggedIn = true;
    } catch {
      $('loginError').classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
    if (loggedIn) {
      $('password').value = '';
      await showConsole();
    }
  });

  $('logoutBtn').addEventListener('click', async function () {
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch {
      /* session is gone either way */
    }
    showLogin();
  });

  // ─── Tabs ───────────────────────────────────────────────────────────────────

  document.querySelectorAll('.roster-tab').forEach((tab) => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.roster-tab').forEach((t) => t.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.roster-panel').forEach((p) => p.classList.add('hidden'));
      $('tab-' + this.dataset.tab).classList.remove('hidden');
    });
  });

  // ─── Volunteers ─────────────────────────────────────────────────────────────

  async function loadVolunteers() {
    volunteers = await api('/api/admin/volunteers');
    renderVolunteers();
  }

  function filteredVolunteers() {
    const q = $('volunteerSearch').value.trim().toLowerCase();
    const status = $('statusFilter').value;
    const availability = $('availabilityFilter').value;

    let rows = volunteers.filter((v) => {
      if (status && v.status !== status) return false;
      if (availability && v.availability !== availability) return false;
      if (q) {
        const haystack = [v.name, v.email, v.organization].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const av = a[sortKey] || '';
      const bv = b[sortKey] || '';
      const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }

  function renderVolunteers() {
    const rows = filteredVolunteers();
    $('volunteerCount').textContent = volunteers.length || '';
    $('volunteerEmpty').classList.toggle('hidden', rows.length > 0);

    document.querySelectorAll('#volunteerTable th').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      const sorted = th.dataset.sort === sortKey;
      if (sorted) th.classList.add('sorted-' + sortDir);
      th.setAttribute(
        'aria-sort',
        sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      );
    });

    const tbody = document.querySelector('#volunteerTable tbody');
    tbody.innerHTML = rows
      .map(
        (v) => `
        <tr data-id="${esc(v.id)}" tabindex="0">
          <td>${esc(v.name)}</td>
          <td>${esc(v.email)}</td>
          <td>${esc(v.organization) || '—'}</td>
          <td>${esc(v.availability) || '—'}</td>
          <td>${fmtDate(v.created_at)}</td>
          <td><span class="status-badge status-${esc(v.status)}">${esc(v.status)}</span></td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => openDetail(tr.dataset.id, tr));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(tr.dataset.id, tr);
        }
      });
    });
  }

  ['volunteerSearch', 'statusFilter', 'availabilityFilter'].forEach((id) => {
    $(id).addEventListener('input', renderVolunteers);
  });

  document.querySelectorAll('#volunteerTable th[data-sort]').forEach((th) => {
    const toggleSort = function () {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      renderVolunteers();
    };
    th.addEventListener('click', toggleSort);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSort();
      }
    });
  });

  // ─── Volunteer detail modal ─────────────────────────────────────────────────

  let detailTrigger = null; // element to restore focus to when the dialog closes

  function openDetail(id, trigger) {
    currentDetail = volunteers.find((v) => v.id === id);
    if (!currentDetail) return;
    detailTrigger = trigger || document.activeElement;

    $('detailName').textContent = currentDetail.name;
    $('detailFields').innerHTML = [
      ['Email', currentDetail.email],
      ['Phone', currentDetail.phone],
      ['Organization', currentDetail.organization],
      ['Skills', currentDetail.skills],
      ['Availability', currentDetail.availability],
      ['Signed up', fmtDate(currentDetail.created_at)],
    ]
      .map(([label, value]) => `<dt>${label}</dt><dd>${esc(value) || '—'}</dd>`)
      .join('');
    $('detailStatus').value = currentDetail.status;
    $('detailNotes').value = currentDetail.notes || '';
    $('detailOverlay').classList.remove('hidden');
    $('detailClose').focus();
  }

  function closeDetail() {
    $('detailOverlay').classList.add('hidden');
    currentDetail = null;
    if (detailTrigger && document.contains(detailTrigger)) detailTrigger.focus();
    detailTrigger = null;
  }

  $('detailClose').addEventListener('click', closeDetail);
  $('detailOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeDetail();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('detailOverlay').classList.contains('hidden')) closeDetail();
    if (!$('addOverlay').classList.contains('hidden')) closeAdd();
    if (!$('noteOverlay').classList.contains('hidden')) closeNote();
  });

  $('detailSave').addEventListener('click', async function () {
    if (!currentDetail) return;
    this.disabled = true;
    try {
      await api('/api/admin/volunteers', {
        method: 'PATCH',
        body: JSON.stringify({
          id: currentDetail.id,
          status: $('detailStatus').value,
          notes: $('detailNotes').value,
        }),
      });
      closeDetail();
      await loadVolunteers();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      this.disabled = false;
    }
  });

  $('detailDelete').addEventListener('click', async function () {
    if (!currentDetail) return;
    if (!confirm('Delete ' + currentDetail.name + ' from the roster? This cannot be undone.'))
      return;
    this.disabled = true;
    try {
      await api('/api/admin/volunteers', {
        method: 'DELETE',
        body: JSON.stringify({ id: currentDetail.id }),
      });
      closeDetail();
      await loadVolunteers();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    } finally {
      this.disabled = false;
    }
  });

  // ─── Add volunteer modal ────────────────────────────────────────────────────

  let addTrigger = null; // element to restore focus to when the add dialog closes

  function openAdd() {
    addTrigger = document.activeElement;
    $('addForm').reset();
    $('addError').classList.add('hidden');
    $('addOverlay').classList.remove('hidden');
    $('add-name').focus();
  }

  function closeAdd() {
    $('addOverlay').classList.add('hidden');
    if (addTrigger && document.contains(addTrigger)) addTrigger.focus();
    addTrigger = null;
  }

  $('addVolunteerBtn').addEventListener('click', openAdd);
  $('addClose').addEventListener('click', closeAdd);
  $('addCancel').addEventListener('click', closeAdd);
  $('addOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeAdd();
  });

  $('addForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    $('addError').classList.add('hidden');
    try {
      await api('/api/admin/volunteers', {
        method: 'POST',
        body: JSON.stringify({
          name: $('add-name').value.trim(),
          email: $('add-email').value.trim(),
          phone: $('add-phone').value.trim() || null,
          organization: $('add-organization').value.trim() || null,
          skills: $('add-skills').value.trim() || null,
          availability: $('add-availability').value || null,
          status: $('add-status').value,
          notes: $('add-notes').value.trim() || null,
        }),
      });
      closeAdd();
      await loadVolunteers();
    } catch (err) {
      $('addError').textContent = 'Could not add volunteer: ' + err.message;
      $('addError').classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  // ─── CSV export ─────────────────────────────────────────────────────────────

  $('exportCsvBtn').addEventListener('click', function () {
    const cols = [
      'name',
      'email',
      'phone',
      'organization',
      'skills',
      'availability',
      'status',
      'notes',
      'created_at',
    ];
    const csvCell = (value) => {
      let cell = String(value == null ? '' : value);
      // Prefix formula-like values so spreadsheet apps treat them as text
      // (CSV injection: volunteer-controlled fields starting with = + - @).
      if (/^\s*[=+\-@]/.test(cell)) cell = "'" + cell;
      return '"' + cell.replace(/"/g, '""') + '"';
    };
    const lines = [cols.join(',')].concat(
      filteredVolunteers().map((v) => cols.map((c) => csvCell(v[c])).join(','))
    );
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dare-volunteers-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ─── Contact inbox ──────────────────────────────────────────────────────────

  async function loadContacts() {
    contacts = await api('/api/admin/contacts');
    renderContacts();
  }

  function renderContacts() {
    const unread = contacts.filter((c) => !c.read_at).length;
    $('unreadCount').textContent = unread || '';
    $('contactEmpty').classList.toggle('hidden', contacts.length > 0);

    $('contactList').innerHTML = contacts
      .map(
        (c) => `
        <div class="contact-card ${c.read_at ? '' : 'unread'}" data-id="${esc(c.id)}" tabindex="0">
          <div class="contact-meta">
            <span class="contact-name">${esc(c.name)} &lt;${esc(c.email)}&gt;</span>
            <span>${esc(c.subject) || 'No subject'} · ${fmtDate(c.created_at)}</span>
          </div>
          <div class="contact-preview">${esc(c.message)}</div>
          <div class="contact-actions">
            <button class="btn btn-outline btn-small" data-action="toggle-read">
              ${c.read_at ? 'Mark unread' : 'Mark read'}
            </button>
            <button class="btn btn-danger btn-small" data-action="delete">Delete</button>
          </div>
        </div>`
      )
      .join('');

    $('contactList')
      .querySelectorAll('.contact-card')
      .forEach((card) => {
        card.addEventListener('keydown', function (e) {
          // Enter/Space on the card toggles it open; inner buttons are real
          // <button> elements and handle their own keyboard activation.
          if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
            e.preventDefault();
            card.click();
          }
        });
        card.addEventListener('click', async function (e) {
          const id = this.dataset.id;
          const contact = contacts.find((c) => c.id === id);
          const action = e.target.dataset && e.target.dataset.action;

          if (action === 'delete') {
            if (!confirm('Delete this message? This cannot be undone.')) return;
            await api('/api/admin/contacts', {
              method: 'DELETE',
              body: JSON.stringify({ id }),
            });
            await loadContacts();
            return;
          }

          if (action === 'toggle-read') {
            await api('/api/admin/contacts', {
              method: 'PATCH',
              body: JSON.stringify({ id, read: !contact.read_at }),
            });
            await loadContacts();
            return;
          }

          // Open/close the card; opening an unread message marks it read.
          const wasOpen = this.classList.contains('open');
          document
            .querySelectorAll('.contact-card.open')
            .forEach((c) => c.classList.remove('open'));
          if (!wasOpen) {
            this.classList.add('open');
            if (!contact.read_at) {
              await api('/api/admin/contacts', {
                method: 'PATCH',
                body: JSON.stringify({ id, read: true }),
              });
              contact.read_at = new Date().toISOString();
              this.classList.remove('unread');
              const unreadNow = contacts.filter((c) => !c.read_at).length;
              $('unreadCount').textContent = unreadNow || '';
              const btn = this.querySelector('[data-action="toggle-read"]');
              if (btn) btn.textContent = 'Mark unread';
            }
          }
        });
      });
  }

  // ─── Impact stats ───────────────────────────────────────────────────────────

  const STAT_FIELDS = [
    'homes_repaired',
    'families_helped',
    'deployments_completed',
    'volunteer_hours',
    'partner_organizations',
    'years_of_service',
  ];

  async function loadStats() {
    // Cache-buster so the console always shows the just-saved numbers.
    const data = await api('/api/impact-stats?t=' + Date.now());
    STAT_FIELDS.forEach((f) => {
      $(f).value = data[f] ?? 0;
    });
    $('statsUpdated').textContent = data.updated_at
      ? new Date(data.updated_at).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : '—';
  }

  $('statsForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    $('statsSaved').classList.add('hidden');
    try {
      const payload = {};
      STAT_FIELDS.forEach((f) => {
        payload[f] = Number($(f).value);
      });
      await api('/api/admin/impact-stats', { method: 'PUT', body: JSON.stringify(payload) });
      $('statsSaved').classList.remove('hidden');
      await loadStats();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Field notes ────────────────────────────────────────────────────────────
  // Trip recaps for the public "From the Field" section. Entries live in the
  // database; the public pages are static, so published changes appear after
  // Netlify rebuilds the site (~1–2 minutes).

  let notes = [];
  let currentNote = null;
  let noteTrigger = null;

  function fmtTripDates(note) {
    const opts = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
    const start = new Date(note.start_date).toLocaleDateString('en-US', opts);
    if (!note.end_date || note.end_date === note.start_date) return start;
    return start + ' – ' + new Date(note.end_date).toLocaleDateString('en-US', opts);
  }

  async function loadFieldNotes() {
    notes = await api('/api/admin/field-notes');
    renderFieldNotes();
  }

  function renderFieldNotes() {
    const drafts = notes.filter((n) => n.status === 'draft').length;
    $('noteCount').textContent = drafts || '';
    $('noteEmpty').classList.toggle('hidden', notes.length > 0);

    $('noteList').innerHTML = notes
      .map(
        (n) => `
        <div class="contact-card note-card" data-id="${esc(n.id)}" tabindex="0">
          <div class="contact-meta">
            <span class="contact-name">${esc(n.title)}</span>
            <span>${esc(fmtTripDates(n))} · ${n.photos.length} photo${n.photos.length === 1 ? '' : 's'}</span>
          </div>
          <div class="contact-actions">
            <span class="status-badge status-${esc(n.status)}">${esc(n.status)}</span>
            <button class="btn btn-outline btn-small" data-action="edit">Edit</button>
          </div>
        </div>`
      )
      .join('');

    $('noteList')
      .querySelectorAll('.note-card')
      .forEach((card) => {
        const open = () => openNote(card.dataset.id, card);
        card.addEventListener('click', open);
        card.addEventListener('keydown', function (e) {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
            e.preventDefault();
            open();
          }
        });
      });
  }

  // ─── Field note editor modal ────────────────────────────────────────────────

  function isoInputDate(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  function openNote(id, trigger) {
    currentNote = id ? notes.find((n) => n.id === id) : null;
    noteTrigger = trigger || document.activeElement;

    $('noteForm').reset();
    $('noteError').classList.add('hidden');
    $('noteModalTitle').textContent = currentNote ? 'Edit Field Note' : 'New Field Note';
    $('note-title').value = currentNote ? currentNote.title : '';
    $('note-start').value = currentNote ? isoInputDate(currentNote.start_date) : '';
    $('note-end').value = currentNote ? isoInputDate(currentNote.end_date) : '';
    $('note-body').value = currentNote ? currentNote.body : '';

    updateNoteControls();
    renderPhotoStrip();
    $('noteOverlay').classList.remove('hidden');
    $('note-title').focus();
  }

  function closeNote() {
    $('noteOverlay').classList.add('hidden');
    currentNote = null;
    if (noteTrigger && document.contains(noteTrigger)) noteTrigger.focus();
    noteTrigger = null;
  }

  // Publish/Delete/photos only exist once the entry has been saved; the
  // status line reminds authors that published changes wait on a rebuild.
  function updateNoteControls() {
    const saved = Boolean(currentNote);
    const published = saved && currentNote.status === 'published';

    $('notePhotos').classList.toggle('hidden', !saved);
    $('notePhotoLocked').classList.toggle('hidden', saved);
    $('notePublishBtn').classList.toggle('hidden', !saved);
    $('noteDeleteBtn').classList.toggle('hidden', !saved);
    $('notePublishBtn').textContent = published ? 'Unpublish' : 'Publish';
    $('noteSaveBtn').textContent = published ? 'Save Changes' : 'Save Draft';

    $('noteStatusLine').classList.toggle('hidden', !published);
    $('noteStatusLine').textContent = published
      ? 'Published — saved changes go live after the site rebuilds (~1–2 min).'
      : '';
  }

  function noteFormPayload() {
    return {
      title: $('note-title').value.trim(),
      start_date: $('note-start').value,
      end_date: $('note-end').value || null,
      body: $('note-body').value,
    };
  }

  function showNoteError(message) {
    $('noteError').textContent = message;
    $('noteError').classList.remove('hidden');
  }

  async function saveNote(extra = {}) {
    const payload = noteFormPayload();
    if (!payload.title || !payload.start_date) {
      showNoteError('A title and trip start date are required.');
      return null;
    }
    $('noteError').classList.add('hidden');

    if (currentNote) {
      const result = await api('/api/admin/field-notes', {
        method: 'PATCH',
        body: JSON.stringify({ id: currentNote.id, ...payload, ...extra }),
      });
      await loadFieldNotes();
      currentNote = notes.find((n) => n.id === currentNote.id);
      return result;
    }

    const result = await api('/api/admin/field-notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadFieldNotes();
    currentNote = notes.find((n) => n.id === result.id);
    return result;
  }

  // First save of a new entry keeps the modal open — it's what unlocks the
  // photo section. Later saves close it and confirm with a toast.
  $('noteForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = $('noteSaveBtn');
    const isNew = !currentNote;
    btn.disabled = true;
    try {
      const result = await saveNote();
      if (result) {
        if (isNew) {
          updateNoteControls();
          showToast('Draft saved — you can add photos now.');
        } else {
          const published = currentNote && currentNote.status === 'published';
          closeNote();
          showToast(
            published
              ? 'Saved — changes go live after the site rebuilds (~1–2 min).'
              : 'Draft saved.'
          );
        }
      }
    } catch (err) {
      showNoteError('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $('notePublishBtn').addEventListener('click', async function () {
    if (!currentNote) return;
    const publishing = currentNote.status !== 'published';
    if (!publishing && !confirm('Unpublish this entry? It will be removed from the public site after the next rebuild.')) {
      return;
    }
    this.disabled = true;
    try {
      const result = await saveNote({ status: publishing ? 'published' : 'draft' });
      if (result) updateNoteControls();
    } catch (err) {
      showNoteError((publishing ? 'Publish' : 'Unpublish') + ' failed: ' + err.message);
    } finally {
      this.disabled = false;
    }
  });

  $('noteDeleteBtn').addEventListener('click', async function () {
    if (!currentNote) return;
    if (!confirm('Delete "' + currentNote.title + '" and its photos? This cannot be undone.')) return;
    this.disabled = true;
    try {
      await api('/api/admin/field-notes', {
        method: 'DELETE',
        body: JSON.stringify({ id: currentNote.id }),
      });
      closeNote();
      await loadFieldNotes();
    } catch (err) {
      showNoteError('Delete failed: ' + err.message);
    } finally {
      this.disabled = false;
    }
  });

  $('newNoteBtn').addEventListener('click', () => openNote(null));
  $('noteClose').addEventListener('click', closeNote);
  $('noteCancelBtn').addEventListener('click', closeNote);
  $('noteOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeNote();
  });

  // ─── Field note photos ──────────────────────────────────────────────────────

  function renderPhotoStrip() {
    const photos = currentNote ? currentNote.photos : [];
    $('photoStrip').innerHTML = photos
      .map(
        (p) => `
        <figure class="photo-thumb" data-id="${esc(p.id)}">
          <img src="${esc(p.url)}" alt="${esc(p.alt)}">
          <input type="text" value="${esc(p.alt)}" placeholder="Caption (optional)" data-field="alt" aria-label="Photo caption">
          <div class="photo-thumb-actions">
            <label class="photo-cover-label">
              <input type="radio" name="cover-photo" data-field="cover" ${p.is_cover ? 'checked' : ''}> Cover
            </label>
            <button type="button" class="btn btn-danger btn-small" data-field="delete">Remove</button>
          </div>
        </figure>`
      )
      .join('');

    $('photoStrip')
      .querySelectorAll('.photo-thumb')
      .forEach((thumb) => {
        const id = thumb.dataset.id;
        thumb.querySelector('[data-field="alt"]').addEventListener('change', async function () {
          try {
            await api('/api/admin/field-note-photos', {
              method: 'PATCH',
              body: JSON.stringify({ id, alt: this.value.trim() }),
            });
            await refreshCurrentNote();
          } catch (err) {
            showNoteError('Caption save failed: ' + err.message);
          }
        });
        thumb.querySelector('[data-field="cover"]').addEventListener('change', async function () {
          try {
            await api('/api/admin/field-note-photos', {
              method: 'PATCH',
              body: JSON.stringify({ id, is_cover: true }),
            });
            await refreshCurrentNote();
          } catch (err) {
            showNoteError('Could not set cover photo: ' + err.message);
          }
        });
        thumb.querySelector('[data-field="delete"]').addEventListener('click', async function () {
          if (!confirm('Remove this photo?')) return;
          try {
            await api('/api/admin/field-note-photos', {
              method: 'DELETE',
              body: JSON.stringify({ id }),
            });
            await refreshCurrentNote();
          } catch (err) {
            showNoteError('Photo delete failed: ' + err.message);
          }
        });
      });
  }

  async function refreshCurrentNote() {
    const id = currentNote && currentNote.id;
    await loadFieldNotes();
    currentNote = notes.find((n) => n.id === id) || null;
    renderPhotoStrip();
  }

  // Phones produce 4000px+/multi-MB photos; downscale on a canvas before
  // upload so entries stay fast and well under the 5 MB server cap.
  async function downscalePhoto(file, maxDim = 1600, quality = 0.85) {
    if (file.size < 800 * 1024) {
      const probe = await createImageBitmap(file);
      const small = Math.max(probe.width, probe.height) <= maxDim;
      probe.close();
      if (small) return file;
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
        'image/jpeg',
        quality
      );
    });
  }

  $('note-photo-input').addEventListener('change', async function () {
    if (!currentNote) return;
    const files = Array.from(this.files);
    this.value = '';
    $('noteError').classList.add('hidden');

    for (let i = 0; i < files.length; i++) {
      $('photoStatus').textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
      try {
        const blob = await downscalePhoto(files[i]);
        // Raw binary body — not JSON, so this bypasses the api() helper.
        const res = await fetch(
          '/api/admin/field-note-photos?note_id=' + encodeURIComponent(currentNote.id),
          { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }
        );
        if (res.status === 401) {
          showLogin();
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Upload failed (' + res.status + ')');
        }
      } catch (err) {
        showNoteError('"' + files[i].name + '" failed: ' + err.message);
        break;
      }
    }
    $('photoStatus').textContent = '';
    await refreshCurrentNote();
  });

  // ─── Boot ───────────────────────────────────────────────────────────────────

  (async function init() {
    let authenticated = false;
    try {
      ({ authenticated } = await api('/api/admin/login'));
    } catch {
      // Session check unreachable — treat as logged out.
    }
    if (authenticated) {
      await showConsole();
    } else {
      showLogin();
    }
  })();
})();
