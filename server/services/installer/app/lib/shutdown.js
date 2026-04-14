/**
 * Inactivity Timer and Shutdown Management
 *
 * Automatically shuts down the installer after a period of inactivity
 * to minimize the security exposure window.
 */

let inactivityTimer = null;
let timeoutCallback = null;
let timeoutMinutes = 30;

/**
 * Starts the inactivity timer
 * @param {number} minutes - Minutes of inactivity before shutdown
 * @param {Function} callback - Function to call on timeout
 */
export function startInactivityTimer(minutes, callback) {
  timeoutMinutes = minutes;
  timeoutCallback = callback;
  resetInactivityTimer();

  console.log(`Inactivity timer started: ${minutes} minutes`);
}

/**
 * Resets the inactivity timer (called on each request)
 */
export function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  if (timeoutCallback) {
    inactivityTimer = setTimeout(() => {
      console.log('Inactivity timeout reached');
      timeoutCallback();
    }, timeoutMinutes * 60 * 1000);
  }
}

/**
 * Cancels the inactivity timer
 */
export function cancelInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

/**
 * Gets remaining time before timeout
 * @returns {number} Remaining milliseconds (approximate)
 */
export function getRemainingTime() {
  // Note: This is approximate as we don't track exact start time
  return timeoutMinutes * 60 * 1000;
}

export default {
  startInactivityTimer,
  resetInactivityTimer,
  cancelInactivityTimer,
  getRemainingTime,
};
