/**
 * Flashlight App
 * Opens rear camera at maximum resolution with torch/flash enabled.
 * UI can be fully hidden for presentation use.
 */

(function () {
    'use strict';

    // ── DOM Elements ──
    const video         = document.getElementById('cameraFeed');
    const uiOverlay     = document.getElementById('uiOverlay');
    const powerBtn      = document.getElementById('powerBtn');
    const hideUIBtn     = document.getElementById('hideUIBtn');
    const restoreBtn    = document.getElementById('restoreBtn');
    const statusBadge   = document.getElementById('statusBadge');
    const statusText    = statusBadge.querySelector('.status-text');
    const resolutionText = document.getElementById('resolutionText');
    const cameraText    = document.getElementById('cameraText');
    const hintText      = document.getElementById('hintText');
    const errorModal    = document.getElementById('errorModal');
    const errorTitle    = document.getElementById('errorTitle');
    const errorMessage  = document.getElementById('errorMessage');
    const errorRetryBtn = document.getElementById('errorRetryBtn');
    const powerLabel    = powerBtn.querySelector('.power-label');

    // ── State ──
    let stream       = null;
    let track        = null;
    let torchOn      = false;
    let uiHidden     = false;

    // ── Initialize ──
    function init() {
        powerBtn.addEventListener('click', toggleFlashlight);
        hideUIBtn.addEventListener('click', hideUI);
        restoreBtn.addEventListener('click', showUI);
        errorRetryBtn.addEventListener('click', () => {
            closeErrorModal();
            toggleFlashlight();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                toggleUI();
            }
            if (e.code === 'Escape') {
                if (uiHidden) showUI();
            }
        });

        // Double-tap to toggle UI on mobile
        let lastTap = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTap < 300) {
                e.preventDefault();
                toggleUI();
            }
            lastTap = now;
        });

        // Update hint for mobile
        if ('ontouchstart' in window) {
            hintText.innerHTML = 'انقر مرتين لإخفاء/إظهار الواجهة';
        }
    }

    // ── Flashlight Toggle ──
    async function toggleFlashlight() {
        if (stream) {
            stopCamera();
            return;
        }
        await startCamera();
    }

    // ── Start Camera ──
    async function startCamera() {
        try {
            // Request maximum resolution from the rear camera
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 9999 },
                    height: { ideal: 9999 },
                },
                audio: false
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            track  = stream.getVideoTracks()[0];

            video.srcObject = stream;
            await video.play();

            // Try to enable torch
            await enableTorch();

            // Update UI
            const settings = track.getSettings();
            const w = settings.width  || '?';
            const h = settings.height || '?';
            resolutionText.textContent = `${w} × ${h}`;

            const label = track.label || '';
            if (label) {
                // Shorten camera label
                const short = label.length > 30 ? label.substring(0, 28) + '…' : label;
                cameraText.textContent = short;
            }

            setActive(true);

        } catch (err) {
            console.error('Camera error:', err);
            handleCameraError(err);
        }
    }

    // ── Enable Torch ──
    async function enableTorch() {
        if (!track) return;

        const capabilities = track.getCapabilities ? track.getCapabilities() : {};

        if (capabilities.torch) {
            try {
                await track.applyConstraints({ advanced: [{ torch: true }] });
                torchOn = true;
            } catch (e) {
                console.warn('Could not enable torch:', e);
                torchOn = false;
            }
        } else {
            console.warn('Torch not supported on this device/camera.');
            torchOn = false;
        }
    }

    // ── Stop Camera ──
    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }
        stream   = null;
        track    = null;
        torchOn  = false;
        video.srcObject = null;
        setActive(false);
        resolutionText.textContent = '--';
        cameraText.textContent = 'الكاميرا الخلفية';
    }

    // ── UI State Helpers ──
    function setActive(active) {
        if (active) {
            powerBtn.classList.add('active');
            statusBadge.classList.add('active');
            statusText.textContent = torchOn ? 'الكشاف مفعّل' : 'الكاميرا مفعّلة';
            powerLabel.textContent = 'إيقاف الكشاف';
        } else {
            powerBtn.classList.remove('active');
            statusBadge.classList.remove('active');
            statusText.textContent = 'غير متصل';
            powerLabel.textContent = 'تشغيل الكشاف';
        }
    }

    // ── Hide / Show UI ──
    function toggleUI() {
        if (uiHidden) showUI();
        else hideUI();
    }

    function hideUI() {
        uiOverlay.classList.add('hidden');
        restoreBtn.classList.add('visible');
        uiHidden = true;

        // Auto-hide restore button after a delay
        setTimeout(() => {
            if (uiHidden) {
                restoreBtn.style.opacity = '0.3';
            }
        }, 4000);
    }

    function showUI() {
        uiOverlay.classList.remove('hidden');
        restoreBtn.classList.remove('visible');
        restoreBtn.style.opacity = '';
        uiHidden = false;
    }

    // ── Error Handling ──
    function handleCameraError(err) {
        let title = 'خطأ في الكاميرا';
        let message = 'حدث خطأ غير متوقع. تأكد من أن المتصفح يدعم الكاميرا.';

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            title = 'الإذن مطلوب';
            message = 'يرجى السماح بالوصول إلى الكاميرا من إعدادات المتصفح ثم إعادة المحاولة.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            title = 'لم يتم العثور على كاميرا';
            message = 'لم يتم اكتشاف أي كاميرا على هذا الجهاز.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            title = 'الكاميرا مشغولة';
            message = 'يبدو أن الكاميرا مستخدمة من تطبيق آخر. أغلق التطبيقات الأخرى وأعد المحاولة.';
        } else if (err.name === 'OverconstrainedError') {
            title = 'خطأ في الإعدادات';
            message = 'لم تتمكن الكاميرا من تلبية الإعدادات المطلوبة.';
        }

        showErrorModal(title, message);
    }

    function showErrorModal(title, message) {
        errorTitle.textContent   = title;
        errorMessage.textContent = message;
        errorModal.classList.add('visible');
    }

    function closeErrorModal() {
        errorModal.classList.remove('visible');
    }

    // ── Clean Up ──
    window.addEventListener('beforeunload', stopCamera);

    // ── Start ──
    init();
})();
