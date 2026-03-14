// Toast Notifications — disabled (popups suppressed for tablet play)
export function showToast(message, type = 'info', duration = 3000) {
  // Intentionally suppressed
}


export function showError(message) {
  showToast(message, 'error', 5000);
}

export function showSuccess(message) {
  showToast(message, 'success');
}
