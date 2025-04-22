function initPasswordToggle() {
  const passwordToggle = document.querySelector('.password-toggle');

  if (passwordToggle) {
    passwordToggle.removeEventListener('click', togglePassword);
    passwordToggle.addEventListener('click', togglePassword);
  }
}

function togglePassword(event) {
  const passwordInput = this.parentElement.querySelector('input[name="password"]');
  const icon = this.querySelector('.material-symbols-outlined');

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.textContent = 'visibility_off';
  } else {
    passwordInput.type = 'password';
    icon.textContent = 'visibility';
  }
}

document.addEventListener('DOMContentLoaded', initPasswordToggle);
document.addEventListener('htmx:afterSwap', initPasswordToggle);
