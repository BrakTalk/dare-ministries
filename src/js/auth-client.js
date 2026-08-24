import {
  getUser,
  handleAuthCallback,
  login,
  requestPasswordRecovery,
  signup,
  updateUser,
} from '/js/vendor/netlify-identity.js';

const statusElement = document.getElementById('accountStatus');

function setStatus(message, type = 'info') {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.className = 'account-status ' + type;
}

function setFormBusy(form, busy, busyLabel) {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.originalLabel;
}

function friendlyError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('identity is not available') || message.includes('failed to fetch')) {
    return 'The account service is not available in this preview. Please try again from the live website.';
  }
  if (message.includes('invalid login') || message.includes('invalid credentials')) {
    return 'The email address or password is incorrect.';
  }
  if (message.includes('confirm') && message.includes('email')) {
    return 'Please open the confirmation email before signing in.';
  }
  if (message.includes('already') || message.includes('registered')) {
    return 'An account already exists for this email address. Try signing in or resetting your password.';
  }
  if (message.includes('password')) {
    return 'The password was not accepted. Please use at least 10 characters and try again.';
  }
  return 'Something went wrong. Please try again.';
}

function signInDestination() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next === '/roster/' ? '/roster/' : '/portal/';
}

async function processIdentityCallback() {
  if (!window.location.hash || !/_token=|access_token=/.test(window.location.hash)) return null;

  try {
    const result = await handleAuthCallback();
    if (!result) return null;

    if (result.type === 'recovery') {
      if (window.location.pathname !== '/reset-password/') {
        window.location.replace('/reset-password/');
      }
      return result;
    }

    window.location.replace('/portal/');
    return result;
  } catch (error) {
    const message = friendlyError(error);
    if (statusElement) {
      setStatus(message, 'error');
    } else {
      window.sessionStorage.setItem('dareAuthError', message);
      window.location.replace('/login/?authError=1');
    }
    return null;
  }
}

const callbackResult = await processIdentityCallback();

const loginForm = document.getElementById('loginForm');
if (loginForm && !callbackResult) {
  const existingUser = await getUser();
  if (existingUser) {
    window.location.replace(signInDestination());
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('signedOut') === '1') setStatus('You have been signed out.', 'success');
  if (params.get('authError') === '1') {
    setStatus(
      window.sessionStorage.getItem('dareAuthError') ||
        'The secure account link could not be completed. Please try again.',
      'error'
    );
    window.sessionStorage.removeItem('dareAuthError');
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    setFormBusy(loginForm, true, 'Signing In...');
    try {
      await login(
        document.getElementById('loginEmail').value.trim(),
        document.getElementById('loginPassword').value
      );
      window.location.assign(signInDestination());
    } catch (error) {
      setStatus(friendlyError(error), 'error');
      setFormBusy(loginForm, false);
    }
  });
}

const registerForm = document.getElementById('registerForm');
if (registerForm && !callbackResult) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');

    const password = document.getElementById('registerPassword').value;
    const confirmation = document.getElementById('registerPasswordConfirm').value;
    if (password !== confirmation) {
      setStatus('The two passwords do not match.', 'error');
      return;
    }

    setFormBusy(registerForm, true, 'Creating Account...');
    try {
      await signup(document.getElementById('registerEmail').value.trim(), password, {
        full_name: document.getElementById('registerName').value.trim(),
        phone: document.getElementById('registerPhone').value.trim(),
        organization: document.getElementById('registerOrganization').value.trim(),
        request_reason: document.getElementById('registerReason').value.trim(),
      });

      const signedInUser = await getUser();
      if (signedInUser) {
        window.location.assign('/portal/');
        return;
      }

      registerForm.reset();
      registerForm.querySelectorAll('input, textarea, button').forEach((control) => {
        control.disabled = true;
      });
      setStatus(
        'Your account has been created. Open the confirmation email we sent you, then a ministry coordinator can review your request.',
        'success'
      );
    } catch (error) {
      setStatus(friendlyError(error), 'error');
      setFormBusy(registerForm, false);
    }
  });
}

const forgotPasswordForm = document.getElementById('forgotPasswordForm');
if (forgotPasswordForm && !callbackResult) {
  forgotPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    setFormBusy(forgotPasswordForm, true, 'Sending Email...');
    try {
      await requestPasswordRecovery(document.getElementById('recoveryEmail').value.trim());
      forgotPasswordForm.reset();
      setStatus(
        'If that address is connected to an account, a password reset email is on its way.',
        'success'
      );
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      setFormBusy(forgotPasswordForm, false);
    }
  });
}

const resetPasswordForm = document.getElementById('resetPasswordForm');
if (resetPasswordForm) {
  const recoveryUser = await getUser();
  if (!recoveryUser && !callbackResult) {
    setStatus(
      'Open the secure link in your password reset email before using this form.',
      'warning'
    );
    resetPasswordForm.querySelector('button[type="submit"]').disabled = true;
  }

  resetPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const password = document.getElementById('newPassword').value;
    if (password !== document.getElementById('newPasswordConfirm').value) {
      setStatus('The two passwords do not match.', 'error');
      return;
    }

    setFormBusy(resetPasswordForm, true, 'Saving Password...');
    try {
      await updateUser({ password });
      setStatus('Your password has been changed. Opening the portal...', 'success');
      window.setTimeout(() => window.location.assign('/portal/'), 700);
    } catch (error) {
      setStatus(friendlyError(error), 'error');
      setFormBusy(resetPasswordForm, false);
    }
  });
}
