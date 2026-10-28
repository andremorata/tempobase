export async function notifyTimerStarted(entryId: string, startTime: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'TIMER_STARTED', entryId, startTime });
  } catch {
    // Background may not be reachable; it will resync when the popup next opens.
  }
}

export async function notifyTimerStopped(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'TIMER_STOPPED' });
  } catch {
    // Background may not be reachable; it will resync when the popup next opens.
  }
}
