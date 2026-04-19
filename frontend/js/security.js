// ============================================
// FRONTEND SECURITY GUARD
// Best-effort deterrence against copying / DevTools
// ============================================

(function bootstrapSecurityGuard() {
    const DEVTOOLS_CHECK_INTERVAL_MS = 1200;
    const DEVTOOLS_DIMENSION_THRESHOLD = 180;
    const DEBUGGER_DELAY_THRESHOLD_MS = 180;
    const SHUTDOWN_DELAY_MS = 80;
    const PASSIVE_DETECTION_WINDOW_MS = 10000;
    const PASSIVE_DETECTION_THRESHOLD = 4;
    const LOCK_MESSAGE = 'Truy cap Developer Tools hoac sao chep noi dung da bi chan.';
    const buildApiUrl = window.buildApiUrl || ((path = '') => {
        const clean = String(path || '').replace(/^\/+/, '');
        return `/api/${clean}`;
    });
    const CLIENT_VIOLATION_ENDPOINT = buildApiUrl('security/client-violation');

    let lockTriggered = false;
    let overlayEl = null;
    let violationReported = false;
    let monitorIntervalId = 0;
    let passiveDetectionScore = 0;
    let lastPassiveDetectionAt = 0;

    function getCurrentUser() {
        try {
            const raw = localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function isAdminBypass() {
        return getCurrentUser()?.role === 'admin';
    }

    function isEditableTarget(target) {
        if (!target || !(target instanceof Element)) {
            return false;
        }

        const tagName = (target.tagName || '').toLowerCase();
        return target.isContentEditable || tagName === 'input' || tagName === 'textarea';
    }

    function syncProtectionState() {
        if (!document.body) {
            return;
        }

        if (isAdminBypass()) {
            document.body.classList.remove('security-protected');
            return;
        }

        document.body.classList.add('security-protected');
    }

    function ensureOverlay() {
        if (overlayEl) {
            return overlayEl;
        }

        overlayEl = document.createElement('div');
        overlayEl.className = 'security-overlay-root';
        overlayEl.innerHTML = [
            '<div class="security-overlay-panel">',
            '<div class="security-overlay-badge">Protected</div>',
            '<h1>Truy cap bi khoa</h1>',
            `<p>${LOCK_MESSAGE}</p>`,
            '<p>Vui long dong cong cu kiem tra va tai lai trang neu ban muon tiep tuc.</p>',
            '</div>'
        ].join('');

        return overlayEl;
    }

    function reportViolation(reason = 'client_violation', detail = '') {
        if (violationReported || isAdminBypass()) {
            return;
        }

        violationReported = true;
        const payload = JSON.stringify({
            reason,
            detail,
            path: `${window.location.pathname}${window.location.search}${window.location.hash}`
        });
        let queued = false;

        try {
            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'application/json' });
                queued = navigator.sendBeacon(CLIENT_VIOLATION_ENDPOINT, blob);
            }
        } catch (_) {
            // ignore beacon failures
        }

        if (!queued) {
            try {
                fetch(CLIENT_VIOLATION_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    keepalive: true,
                    body: payload
                }).catch(() => {});
            } catch (_) {
                // ignore keepalive failures
            }
        }
    }

    function shutdownPage(reason = 'security_shutdown', detail = '') {
        if (lockTriggered) {
            return;
        }

        reportViolation(reason, detail);
        lockTriggered = true;
        document.documentElement.classList.add('security-locked');
        document.body?.classList.add('security-locked');

        try {
            sessionStorage.setItem('security_lock_reason', reason);
        } catch (_) {
            // ignore storage failures
        }

        window.setTimeout(() => {
            try {
                document.documentElement.innerHTML = '';
            } catch (_) {
                // ignore DOM cleanup failures
            }

            try {
                window.open('', '_self');
            } catch (_) {
                // ignore
            }

            try {
                window.close();
            } catch (_) {
                // ignore
            }

            window.setTimeout(() => {
                try {
                    window.location.replace('about:blank');
                } catch (_) {
                    // ignore
                }
            }, 20);
        }, SHUTDOWN_DELAY_MS);
    }

    function lockInterface(reason = 'security_violation') {
        if (lockTriggered || isAdminBypass()) {
            return;
        }

        lockTriggered = true;
        document.documentElement.classList.add('security-locked');
        document.body?.classList.add('security-locked');
        document.body?.appendChild(ensureOverlay());

        try {
            sessionStorage.setItem('security_lock_reason', reason);
        } catch (_) {
            // ignore storage failures
        }
    }

    function decayPassiveDetection(now = Date.now()) {
        if (!lastPassiveDetectionAt) {
            passiveDetectionScore = 0;
            return;
        }

        if (now - lastPassiveDetectionAt > PASSIVE_DETECTION_WINDOW_MS) {
            passiveDetectionScore = 0;
            lastPassiveDetectionAt = 0;
        }
    }

    function registerPassiveDetection(reason = 'devtools_detected', detail = '', weight = 1) {
        if (lockTriggered || isAdminBypass()) {
            return;
        }

        const now = Date.now();
        decayPassiveDetection(now);

        if (!lastPassiveDetectionAt || now - lastPassiveDetectionAt > PASSIVE_DETECTION_WINDOW_MS) {
            passiveDetectionScore = 0;
        }

        passiveDetectionScore += Math.max(Number(weight) || 0, 0);
        lastPassiveDetectionAt = now;

        if (passiveDetectionScore >= PASSIVE_DETECTION_THRESHOLD) {
            reportViolation(reason, detail);
            lockInterface(reason);
        }
    }

    function preventIfProtected(event, allowEditableTarget = false) {
        if (isAdminBypass()) {
            return;
        }

        if (allowEditableTarget && isEditableTarget(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        event.returnValue = false;
    }

    function isBlockedShortcut(event) {
        const key = String(event.key || '').toLowerCase();
        const ctrlOrMeta = event.ctrlKey || event.metaKey;
        const shift = event.shiftKey;
        const keyCode = Number(event.keyCode || event.which || 0);

        return (
            key === 'f12' ||
            keyCode === 123 ||
            (ctrlOrMeta && shift && ['i', 'j'].includes(key)) ||
            (ctrlOrMeta && ['u', 's', 'x'].includes(key))
        );
    }

    function handleKeyEvent(event) {
        if (!isBlockedShortcut(event)) {
            return;
        }

        const key = String(event.key || event.keyCode || '').toLowerCase();
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        event.returnValue = false;
        shutdownPage(`keyboard_${key}`, `shortcut=${key}`);
    }

    function detectDevToolsByViewport() {
        if (isAdminBypass()) {
            return false;
        }

        const widthGap = Math.max(window.outerWidth - window.innerWidth, 0);
        const heightGap = Math.max(window.outerHeight - window.innerHeight, 0);
        return widthGap > DEVTOOLS_DIMENSION_THRESHOLD || heightGap > DEVTOOLS_DIMENSION_THRESHOLD;
    }

    function detectDevToolsByDebugger() {
        if (isAdminBypass()) {
            return false;
        }

        const startedAt = performance.now();
        // eslint-disable-next-line no-debugger
        debugger;
        return performance.now() - startedAt > DEBUGGER_DELAY_THRESHOLD_MS;
    }

    function detectDevToolsByConsoleProbe() {
        if (isAdminBypass()) {
            return false;
        }

        let detected = false;

        try {
            const probe = new Image();
            Object.defineProperty(probe, 'id', {
                configurable: true,
                get() {
                    detected = true;
                    return 'devtools-open';
                }
            });
            console.debug(probe);
        } catch (_) {
            return false;
        }

        return detected;
    }

    function runDevToolsChecks(source = 'interval_monitor') {
        syncProtectionState();

        if (lockTriggered || isAdminBypass()) {
            return;
        }

        const signals = [];
        let weight = 0;

        if (detectDevToolsByViewport()) {
            signals.push('viewport');
            weight += 0.25;
        }

        if (detectDevToolsByDebugger()) {
            signals.push('debugger');
            weight += 2;
        }

        if (detectDevToolsByConsoleProbe()) {
            signals.push('console');
            weight += 2;
        }

        if (!signals.length) {
            decayPassiveDetection();
            return;
        }

        registerPassiveDetection(
            'devtools_detected',
            `detected_by=${source}; signals=${signals.join('|')}`,
            weight
        );
    }

    function startDevToolsMonitor() {
        if (monitorIntervalId) {
            window.clearInterval(monitorIntervalId);
        }

        monitorIntervalId = window.setInterval(() => {
            runDevToolsChecks('interval_monitor');
        }, DEVTOOLS_CHECK_INTERVAL_MS);
    }

    window.addEventListener('keydown', handleKeyEvent, true);
    window.addEventListener('keyup', handleKeyEvent, true);
    window.addEventListener('keypress', handleKeyEvent, true);
    document.addEventListener('keydown', handleKeyEvent, true);
    document.addEventListener('keyup', handleKeyEvent, true);
    document.addEventListener('keypress', handleKeyEvent, true);
    document.addEventListener('contextmenu', (event) => preventIfProtected(event), true);
    document.addEventListener('copy', (event) => preventIfProtected(event, true), true);
    document.addEventListener('cut', (event) => preventIfProtected(event, true), true);
    document.addEventListener('dragstart', (event) => preventIfProtected(event, true), true);
    window.addEventListener('resize', () => runDevToolsChecks('resize_probe'), true);
    window.addEventListener('focus', () => runDevToolsChecks('focus_probe'), true);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            runDevToolsChecks('visibility_probe');
        }
    }, true);

    window.onkeydown = handleKeyEvent;
    document.onkeydown = handleKeyEvent;

    window.addEventListener('DOMContentLoaded', () => {
        syncProtectionState();
        runDevToolsChecks('dom_ready');
        startDevToolsMonitor();
    }, { once: true });
})();
