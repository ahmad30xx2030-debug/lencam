/**
 * Flashlight App
 * Opens rear camera at maximum resolution.
 * Flash/torch is a separate optional toggle.
 * UI can be fully hidden for presentation use.
 */

(function () {
    'use strict';

    // ── DOM Elements ──
    const video         = document.getElementById('cameraFeed');
    const uiOverlay     = document.getElementById('uiOverlay');
    const powerBtn      = document.getElementById('powerBtn');
    const torchBtn      = document.getElementById('torchBtn');
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
    const torchLabel    = torchBtn.querySelector('.torch-label');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const fsExpand      = fullscreenBtn.querySelector('.fs-expand');
    const fsCompress    = fullscreenBtn.querySelector('.fs-compress');

    // ── State ──
    let stream       = null;
    let track        = null;
    let torchOn      = false;
    let torchSupported = false;
    let uiHidden     = false;

    // ── Initialize ──
    function init() {
        powerBtn.addEventListener('click', toggleCamera);
        torchBtn.addEventListener('click', toggleTorch);
        fullscreenBtn.addEventListener('click', toggleFullscreen);
        hideUIBtn.addEventListener('click', hideUI);
        restoreBtn.addEventListener('click', showUI);
        errorRetryBtn.addEventListener('click', () => {
            closeErrorModal();
            toggleCamera();
        });

        // Listen for fullscreen changes (e.g. user presses Escape)
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                toggleUI();
            }
            if (e.code === 'Escape' && !document.fullscreenElement) {
                if (uiHidden) showUI();
            }
            // F key toggles flash
            if (e.code === 'KeyF' && stream) {
                e.preventDefault();
                toggleTorch();
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

        // Check fullscreen support
        checkFullscreenSupport();
    }

    // ── Camera Toggle ──
    async function toggleCamera() {
        if (stream) {
            stopCamera();
            return;
        }
        await startCamera();
    }

    // ── Start Camera ──
    async function startCamera() {
        try {
            // Request maximum resolution and 60fps from the rear camera
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 9999 },
                    height: { ideal: 9999 },
                    frameRate: { ideal: 60 },
                },
                audio: false
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            track  = stream.getVideoTracks()[0];

            video.srcObject = stream;
            await video.play();

            // Check if torch is supported
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            torchSupported = !!capabilities.torch;

            // Update UI
            const settings = track.getSettings();
            const w   = settings.width  || '?';
            const h   = settings.height || '?';
            const fps = settings.frameRate ? Math.round(settings.frameRate) : '?';
            resolutionText.textContent = `${w} × ${h} • ${fps}fps`;

            const label = track.label || '';
            if (label) {
                const short = label.length > 30 ? label.substring(0, 28) + '…' : label;
                cameraText.textContent = short;
            }

            setCameraActive(true);

            // Enable torch button if supported
            if (torchSupported) {
                torchBtn.disabled = false;
                torchBtn.classList.remove('unsupported');
            } else {
                torchBtn.disabled = true;
                torchBtn.classList.add('unsupported');
                torchLabel.textContent = 'الفلاش غير متاح';
            }

        } catch (err) {
            console.error('Camera error:', err);
            handleCameraError(err);
        }
    }

    // ── Toggle Torch ──
    async function toggleTorch() {
        if (!track || !torchSupported) return;

        if (torchOn) {
            await disableTorch();
        } else {
            await enableTorch();
        }
    }

    // ── Enable Torch ──
    async function enableTorch() {
        if (!track) return;

        try {
            await track.applyConstraints({ advanced: [{ torch: true }] });
            torchOn = true;
            setTorchActive(true);
        } catch (e) {
            console.warn('Could not enable torch:', e);
            torchOn = false;
        }
    }

    // ── Disable Torch ──
    async function disableTorch() {
        if (!track) return;

        try {
            await track.applyConstraints({ advanced: [{ torch: false }] });
            torchOn = false;
            setTorchActive(false);
        } catch (e) {
            console.warn('Could not disable torch:', e);
        }
    }

    // ── Stop Camera ──
    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }
        stream         = null;
        track          = null;
        torchOn        = false;
        torchSupported = false;
        video.srcObject = null;
        setCameraActive(false);
        setTorchActive(false);
        torchBtn.disabled = true;
        torchBtn.classList.remove('unsupported');
        torchLabel.textContent = 'تشغيل الفلاش';
        resolutionText.textContent = '--';
        cameraText.textContent = 'الكاميرا الخلفية';
    }

    // ── UI State Helpers ──
    function setCameraActive(active) {
        if (active) {
            powerBtn.classList.add('active');
            statusBadge.classList.add('active');
            statusText.textContent = 'الكاميرا مفعّلة';
            powerLabel.textContent = 'إيقاف الكاميرا';
        } else {
            powerBtn.classList.remove('active');
            statusBadge.classList.remove('active');
            statusText.textContent = 'غير متصل';
            powerLabel.textContent = 'تشغيل الكاميرا';
        }
    }

    function setTorchActive(active) {
        if (active) {
            torchBtn.classList.add('active');
            torchLabel.textContent = 'إيقاف الفلاش';
            // Update status
            statusText.textContent = 'الكاميرا + الفلاش';
        } else {
            torchBtn.classList.remove('active');
            torchLabel.textContent = 'تشغيل الفلاش';
            if (stream) {
                statusText.textContent = 'الكاميرا مفعّلة';
            }
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

    // ── Fullscreen ──
    function isFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    }

    function toggleFullscreen() {
        if (!isFullscreen()) {
            // Enter fullscreen — try documentElement first, then body, then video
            const el = document.documentElement;
            if (el.requestFullscreen) {
                el.requestFullscreen().catch(() => {
                    // Fallback: try on body
                    document.body.requestFullscreen && document.body.requestFullscreen().catch(() => {});
                });
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen();
            } else if (video.webkitEnterFullscreen) {
                // iOS Safari fallback — only works on video elements
                video.webkitEnterFullscreen();
            }
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    function updateFullscreenIcon() {
        const isFS = isFullscreen();
        fsExpand.style.display   = isFS ? 'none' : '';
        fsCompress.style.display = isFS ? '' : 'none';
        fullscreenBtn.classList.toggle('active', isFS);
    }

    // Check if any fullscreen API exists, hide button if not supported at all
    function checkFullscreenSupport() {
        const el = document.documentElement;
        const supported = !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || video.webkitEnterFullscreen);
        if (!supported) {
            fullscreenBtn.style.display = 'none';
        }
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
