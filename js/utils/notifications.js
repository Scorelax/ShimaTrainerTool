// Toast Notifications — disabled (popups suppressed for tablet play)
export function showToast(message, type = 'info', duration = 3000) {
  // Intentionally suppressed
}

function closeToast(toast) {
  toast.classList.remove('show');
  setTimeout(() => toast.remove(), 300);
}

function getIcon(type) {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  return icons[type] || icons.info;
}

export function showError(message) {
  showToast(message, 'error', 5000);
}

export function showSuccess(message) {
  showToast(message, 'success');
}
