// D.A.R.E. Ministries — Supabase integration
// Loaded as an ES module. Credentials are injected by Eleventy via window.__SUPABASE_*.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(window.__SUPABASE_URL__, window.__SUPABASE_KEY__);

// ─── Volunteer Form ───────────────────────────────────────────────────────────

const volunteerForm = document.getElementById('volunteerForm');

if (volunteerForm) {
  volunteerForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const btn = volunteerForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const data = {
      name: volunteerForm.querySelector('#name').value.trim(),
      email: volunteerForm.querySelector('#email').value.trim(),
      phone: volunteerForm.querySelector('#phone').value.trim() || null,
      organization: volunteerForm.querySelector('#church').value.trim() || null,
      skills: volunteerForm.querySelector('#skills').value.trim() || null,
      availability: volunteerForm.querySelector('#availability').value || null,
      notes: volunteerForm.querySelector('#message').value.trim() || null,
    };

    const { error } = await supabase.from('volunteers').insert(data);

    if (error) {
      console.error('Volunteer form error:', error);
      btn.disabled = false;
      btn.textContent = 'Sign Up to Volunteer';
      showFormError(volunteerForm);
    } else {
      showFormSuccess(
        volunteerForm,
        "Thank you for signing up! We'll be in touch soon about upcoming deployments."
      );
    }
  });
}

// ─── Contact Form ─────────────────────────────────────────────────────────────

const contactForm = document.querySelector('.contact-form');

if (contactForm) {
  contactForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const btn = contactForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const data = {
      name: contactForm.querySelector('#contact-name').value.trim(),
      email: contactForm.querySelector('#contact-email').value.trim(),
      subject: contactForm.querySelector('#contact-subject').value || null,
      message: contactForm.querySelector('#contact-message').value.trim(),
    };

    const { error } = await supabase.from('contacts').insert(data);

    if (error) {
      console.error('Contact form error:', error);
      btn.disabled = false;
      btn.textContent = 'Send Message';
      showFormError(contactForm);
    } else {
      showFormSuccess(contactForm, "Thank you for your message! We'll get back to you shortly.");
    }
  });
}

// ─── Impact Counter ───────────────────────────────────────────────────────────
// Strategy: fetch data eagerly on load, animate only when BOTH the data is
// ready AND the section is in the viewport. This fixes the race condition where
// navigating directly to #impact causes the animation to fire before the fetch
// completes, resulting in all zeros.

let _impactData = null; // populated by fetch
let _sectionVisible = false; // tracks whether section is in viewport
let _animating = false; // prevents overlapping animations mid-scroll

const impactSection = document.getElementById('impact');

if (impactSection) {
  // 1. Fetch data immediately — don't wait for scroll
  (async () => {
    const { data, error } = await supabase.from('impact_stats').select('*').eq('id', 1).single();

    if (error || !data) {
      console.error('Impact stats error:', error);
      return;
    }

    _impactData = data;

    // If section already visible when data arrives, animate now.
    if (_sectionVisible) renderImpactStats();
  })();

  // 2. Watch for section entering AND leaving the viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          _sectionVisible = true;
          if (_impactData && !_animating) renderImpactStats();
        } else {
          // Section left — reset numbers so they re-animate on next visit
          _sectionVisible = false;
          _animating = false;
          resetImpactStats();
        }
      });
    },
    { threshold: 0.05 }
  );
  observer.observe(impactSection);
}

function resetImpactStats() {
  [
    'stat-homes',
    'stat-families',
    'stat-deployments',
    'stat-hours',
    'stat-partners',
    'stat-years',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}

function renderImpactStats() {
  if (_animating || !_impactData) return;
  _animating = true;

  const data = _impactData;
  animateCount(document.getElementById('stat-homes'), data.homes_repaired);
  animateCount(document.getElementById('stat-families'), data.families_helped);
  animateCount(document.getElementById('stat-deployments'), data.deployments_completed);
  animateCount(document.getElementById('stat-hours'), data.volunteer_hours, true);
  animateCount(document.getElementById('stat-partners'), data.partner_organizations);
  animateCount(document.getElementById('stat-years'), data.years_of_service);

  const updatedEl = document.getElementById('impact-updated');
  if (updatedEl && data.updated_at) {
    updatedEl.textContent = new Date(data.updated_at).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
}

function animateCount(el, target, useComma = false) {
  if (!el || !target) {
    if (el) el.textContent = '—';
    return;
  }

  const duration = 1800;
  const steps = 60;
  const interval = duration / steps;
  let current = 0;

  const timer = setInterval(() => {
    current += target / steps;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }
    const value = Math.floor(current);
    el.textContent = useComma ? value.toLocaleString() + '+' : value + '+';
  }, interval);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showFormSuccess(form, message) {
  form.parentElement.innerHTML =
    '<div class="form-success">' + '<h4>Message Sent!</h4>' + '<p>' + message + '</p>' + '</div>';
}

function showFormError(form) {
  const existing = form.querySelector('.form-error');
  if (existing) existing.remove();

  const el = document.createElement('p');
  el.className = 'form-error';
  el.textContent =
    'Something went wrong. Please try again or email us at whofixedtheroof@gmail.com';
  form.appendChild(el);
}
