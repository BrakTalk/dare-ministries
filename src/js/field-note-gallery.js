// D.A.R.E. Ministries — public Field Note photo gallery

(function () {
  'use strict';

  const gallery = document.querySelector('.field-gallery');
  const dialog = document.getElementById('fieldPhotoDialog');
  if (!gallery || !dialog) return;

  const triggers = Array.from(gallery.querySelectorAll('.field-gallery-trigger'));
  const photos = triggers.map((trigger, index) => {
    const image = trigger.querySelector('img');
    const caption = trigger.closest('figure').querySelector('figcaption');
    return {
      url: image.getAttribute('src'),
      alt: image.getAttribute('alt') || `Field note photo ${index + 1}`,
      caption: caption ? caption.textContent.trim() : '',
    };
  });

  const previewImage = document.getElementById('fieldPhotoImage');
  const previewCaption = document.getElementById('fieldPhotoCaption');
  const previewPosition = document.getElementById('fieldPhotoPosition');
  const previousButton = document.getElementById('fieldPhotoPrevious');
  const nextButton = document.getElementById('fieldPhotoNext');
  const closeButton = document.getElementById('fieldPhotoClose');
  let currentIndex = 0;
  let activeTrigger = null;

  function renderPhoto() {
    const photo = photos[currentIndex];
    const multiple = photos.length > 1;
    previewImage.src = photo.url;
    previewImage.alt = photo.alt;
    previewCaption.textContent = photo.caption;
    previewCaption.hidden = !photo.caption;
    previewPosition.textContent = `Photo ${currentIndex + 1} of ${photos.length}`;
    previewPosition.hidden = !multiple;
    previousButton.hidden = !multiple;
    nextButton.hidden = !multiple;
  }

  function openPhoto(index, trigger) {
    currentIndex = index;
    activeTrigger = trigger;
    renderPhoto();
    dialog.showModal();
    document.body.classList.add('field-photo-open');
    closeButton.focus();
  }

  function pagePhoto(offset) {
    if (photos.length < 2) return;
    currentIndex = (currentIndex + offset + photos.length) % photos.length;
    renderPhoto();
  }

  function closePhoto() {
    if (!dialog.open) return;
    dialog.close();
    document.body.classList.remove('field-photo-open');
    if (activeTrigger && document.contains(activeTrigger)) activeTrigger.focus();
    activeTrigger = null;
  }

  triggers.forEach((trigger, index) => {
    trigger.addEventListener('click', () => openPhoto(index, trigger));
  });
  previousButton.addEventListener('click', () => pagePhoto(-1));
  nextButton.addEventListener('click', () => pagePhoto(1));
  closeButton.addEventListener('click', closePhoto);
  dialog.addEventListener('click', function (event) {
    if (event.target === this) closePhoto();
  });
  dialog.addEventListener('cancel', function (event) {
    event.preventDefault();
    closePhoto();
  });
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      pagePhoto(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      pagePhoto(1);
    }
  });
})();
