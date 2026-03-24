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

async function loadImpactStats() {
  const els = {
    homes: document.getElementById('stat-homes'),
    families: document.getElementById('stat-families'),
    deployments: document.getElementById('stat-deployments'),
    hours: document.getElementById('stat-hours'),
    partners: document.getElementById('stat-partners'),
    years: document.getElementById('stat-years'),
    updated: document.getElementById('impact-updated'),
  };

  if (!els.homes) return; // section not on page

  const { data, error } = await supabase.from('impact_stats').select('*').eq('id', 1).single();

  if (error || !data) {
    console.error('Impact stats error:', error);
    return;
  }

  // Animate each number counting up
  animateCount(els.homes, data.homes_repaired);
  animateCount(els.families, data.families_helped);
  animateCount(els.deployments, data.deployments_completed);
  animateCount(els.hours, data.volunteer_hours, true);
  animateCount(els.partners, data.partner_organizations);
  animateCount(els.years, data.years_of_service);

  if (els.updated && data.updated_at) {
    els.updated.textContent = new Date(data.updated_at).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
}

function animateCount(el, target, useComma = false) {
  if (!el || target === 0) {
    if (el) el.textContent = '—';
    return;
  }

  const duration = 1800;
  const steps = 50;
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

// Trigger stats load when section scrolls into view
const impactSection = document.getElementById('impact');
if (impactSection) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadImpactStats();
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  observer.observe(impactSection);
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
