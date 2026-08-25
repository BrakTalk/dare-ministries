/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gallerySource = readFileSync(resolve(here, '../field-note-gallery.js'), 'utf8');
const fieldNoteTemplate = readFileSync(resolve(here, '../../field-note.njk'), 'utf8');

interface PhotoFixture {
  url: string;
  alt: string;
  caption?: string;
}

const photos: PhotoFixture[] = [
  { url: '/images/field/note/photo-1', alt: 'Roof repair', caption: 'Roof repair' },
  { url: '/images/field/note/photo-2', alt: 'Volunteer team', caption: 'Volunteer team' },
  { url: '/images/field/note/photo-3', alt: 'Completed home', caption: 'Completed home' },
];

const $ = (id: string) => document.getElementById(id)!;

function markup(items: PhotoFixture[]) {
  return `
    <div class="field-gallery">
      ${items
        .map(
          (photo, index) => `
            <figure class="field-gallery-item">
              <button type="button" class="field-gallery-trigger" data-photo-index="${index}" aria-label="View full size: ${photo.alt}">
                <img src="${photo.url}" alt="${photo.alt}">
              </button>
              ${photo.caption ? `<figcaption>${photo.caption}</figcaption>` : ''}
            </figure>`
        )
        .join('')}
    </div>
    <dialog id="fieldPhotoDialog" aria-label="Full-size field note photo">
      <button type="button" id="fieldPhotoClose">Close</button>
      <button type="button" id="fieldPhotoPrevious">Previous</button>
      <img id="fieldPhotoImage" alt="">
      <button type="button" id="fieldPhotoNext">Next</button>
      <p id="fieldPhotoCaption" hidden></p>
      <p id="fieldPhotoPosition" hidden></p>
    </dialog>`;
}

function boot(items: PhotoFixture[] = photos) {
  document.body.innerHTML = markup(items);
  new Function(gallerySource)();
}

afterEach(() => {
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('public Field Note photo gallery', () => {
  it('✅ PUBLIC-PHOTO-1 wires interactive gallery markup and script into the template', () => {
    expect(fieldNoteTemplate).toContain('class="field-gallery-trigger"');
    expect(fieldNoteTemplate).toContain('id="fieldPhotoDialog"');
    expect(fieldNoteTemplate).toContain('/js/field-note-gallery.js');
  });

  it('✅ PUBLIC-PHOTO-2 opens the selected published photo in the dialog', () => {
    boot();
    const triggers = document.querySelectorAll<HTMLButtonElement>('.field-gallery-trigger');
    triggers[1].click();

    expect(($('fieldPhotoDialog') as HTMLDialogElement).open).toBe(true);
    expect(($('fieldPhotoImage') as HTMLImageElement).getAttribute('src')).toBe(photos[1].url);
    expect($('fieldPhotoCaption').textContent).toBe(photos[1].caption);
    expect($('fieldPhotoPosition').textContent).toBe('Photo 2 of 3');
    expect(document.activeElement).toBe($('fieldPhotoClose'));
    expect(document.body.classList.contains('field-photo-open')).toBe(true);
  });

  it('✅ PUBLIC-PHOTO-3 mouse controls advance one photo and wrap around', () => {
    boot();
    document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!.click();
    const image = $('fieldPhotoImage') as HTMLImageElement;

    $('fieldPhotoPrevious').click();
    expect(image.getAttribute('src')).toBe(photos[2].url);
    $('fieldPhotoNext').click();
    expect(image.getAttribute('src')).toBe(photos[0].url);
  });

  it('✅ PUBLIC-PHOTO-4 ArrowLeft and ArrowRight page the gallery', () => {
    boot();
    document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!.click();
    const dialog = $('fieldPhotoDialog');
    const image = $('fieldPhotoImage') as HTMLImageElement;

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(image.getAttribute('src')).toBe(photos[1].url);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(image.getAttribute('src')).toBe(photos[0].url);
  });

  it('✅ PUBLIC-PHOTO-5 the rendered close control dismisses and restores focus', () => {
    boot();
    const trigger = document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!;
    trigger.click();
    $('fieldPhotoClose').click();

    expect(($('fieldPhotoDialog') as HTMLDialogElement).open).toBe(false);
    expect(document.body.classList.contains('field-photo-open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('✅ PUBLIC-PHOTO-6 clicking the backdrop dismisses the dialog', () => {
    boot();
    document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!.click();
    $('fieldPhotoDialog').click();
    expect(($('fieldPhotoDialog') as HTMLDialogElement).open).toBe(false);
  });

  it('✅ PUBLIC-PHOTO-7 an Escape keydown explicitly dismisses the dialog', () => {
    boot();
    document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!.click();
    const dialog = $('fieldPhotoDialog') as HTMLDialogElement;
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(dialog.open).toBe(false);
  });

  it('⚠️ PUBLIC-PHOTO-8 hides pagination for a single published photo', () => {
    boot([photos[0]]);
    document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!.click();
    expect(($('fieldPhotoPrevious') as HTMLButtonElement).hidden).toBe(true);
    expect(($('fieldPhotoNext') as HTMLButtonElement).hidden).toBe(true);
    expect(($('fieldPhotoPosition') as HTMLParagraphElement).hidden).toBe(true);
  });

  it('🔒 PUBLIC-PHOTO-9 renders the published caption as text', () => {
    const unsafe = '<img src=x onerror="window.__pwned=1">';
    document.body.innerHTML = markup([
      { url: photos[0].url, alt: 'Field photo', caption: 'placeholder' },
    ]);
    document.querySelector('figcaption')!.textContent = unsafe;
    new Function(gallerySource)();
    document.querySelector<HTMLButtonElement>('.field-gallery-trigger')!.click();

    expect($('fieldPhotoCaption').textContent).toBe(unsafe);
    expect($('fieldPhotoCaption').querySelector('img')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
