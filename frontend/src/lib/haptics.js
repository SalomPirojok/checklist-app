import WebApp from '@twa-dev/sdk';

// Haptic calls throw outside a real Telegram client (older clients / desktop
// web), so every call is a defensive no-op there -- mirrors the WebApp.ready()
// guard pattern already used in AuthContext.

export function hapticTap() {
    try {
        WebApp.HapticFeedback.impactOccurred('light');
    } catch {
        // no-op outside Telegram
    }
}

export function hapticSuccess() {
    try {
        WebApp.HapticFeedback.notificationOccurred('success');
    } catch {
        // no-op outside Telegram
    }
}

export function hapticError() {
    try {
        WebApp.HapticFeedback.notificationOccurred('error');
    } catch {
        // no-op outside Telegram
    }
}

export function hapticSelect() {
    try {
        WebApp.HapticFeedback.selectionChanged();
    } catch {
        // no-op outside Telegram
    }
}
