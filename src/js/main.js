// D.A.R.E. Ministries — Main JavaScript

document.addEventListener('DOMContentLoaded', function () {

  // --- Mobile Navigation Toggle ---
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('active');
      navToggle.classList.toggle('active');
    });

    // Close mobile nav when a link is clicked
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('active');
        navToggle.classList.remove('active');
      });
    });
  }

  // --- Navbar scroll effect ---
  const navbar = document.getElementById('navbar');

  function handleScroll() {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId === '#') return;

      var target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // --- Form submission handling (Netlify Forms) ---
  var forms = document.querySelectorAll('form[data-netlify="true"]');
  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var formData = new FormData(form);
      var formName = form.getAttribute('name');

      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formData).toString()
      })
      .then(function (response) {
        if (response.ok) {
          var container = form.parentElement;
          var successMsg = formName === 'volunteer'
            ? 'Thank you for signing up! We\'ll be in touch soon about upcoming deployments.'
            : 'Thank you for your message! We\'ll get back to you shortly.';

          container.innerHTML =
            '<div class="form-success">' +
              '<h4>Message Sent!</h4>' +
              '<p>' + successMsg + '</p>' +
            '</div>';
        } else {
          alert('There was an issue submitting the form. Please try again or contact us directly at whofixedtheroof@gmail.com');
        }
      })
      .catch(function () {
        alert('There was an issue submitting the form. Please try again or contact us directly at whofixedtheroof@gmail.com');
      });
    });
  });

  // --- Intersection Observer for fade-in animations ---
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('fade-in');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    document.querySelectorAll('.service-card, .project-card, .stat').forEach(function (el) {
      observer.observe(el);
    });
  }
});
