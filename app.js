/**
 * Flashlight App
 * Camera with zoom, wide-angle, freeze+draw, torch.
 * Side-controls layout. Freeze hides all UI except draw tools.
 */
(function () {
    'use strict';

    // ── DOM ──
    const video        = document.getElementById('cameraFeed');
    const freezeCanvas = document.getElementById('freezeCanvas');
    const drawCanvas   = document.getElementById('drawCanvas');
    const uiOverlay    = document.getElementById('uiOverlay');
    const powerBtn     = document.getElementById('powerBtn');
    const freezeBtn    = document.getElementById('freezeBtn');
    const torchBtn     = document.getElementById('torchBtn');
    const hideUIBtn    = document.getElementById('hideUIBtn');
    const restoreBtn   = document.getElementById('restoreBtn');
    const statusBadge  = document.getElementById('statusBadge');
    const statusText   = statusBadge.querySelector('.status-text');
    const resText      = document.getElementById('resolutionText');
    const camText      = document.getElementById('cameraText');
    const errorModal   = document.getElementById('errorModal');
    const errorTitle   = document.getElementById('errorTitle');
    const errorMessage = document.getElementById('errorMessage');
    const errorRetry   = document.getElementById('errorRetryBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const fsExpand     = fullscreenBtn.querySelector('.fs-expand');
    const fsCompress   = fullscreenBtn.querySelector('.fs-compress');
    const drawToolbar  = document.getElementById('drawToolbar');
    const drawColorsEl = document.getElementById('drawColors');
    const drawSizesEl  = document.getElementById('drawSizes');
    const eraserBtn    = document.getElementById('eraserBtn');
    const undoBtn      = document.getElementById('undoBtn');
    const clearDrawBtn = document.getElementById('clearDrawBtn');
    const unfreezeBtn  = document.getElementById('unfreezeBtn');
    const zoomSlider   = document.getElementById('zoomSlider');
    const zoomLabel    = document.getElementById('zoomLabel');
    const zoomControls = document.getElementById('zoomControls');
    const sideControls = document.getElementById('sideControls');
    const lensMain     = document.getElementById('lensMain');
    const lensWide     = document.getElementById('lensWide');
    const lensRow      = document.getElementById('lensRow');

    const freezeCtx = freezeCanvas.getContext('2d');
    const drawCtx   = drawCanvas.getContext('2d');

    // ── State ──
    let stream = null, track = null;
    let torchOn = false, torchSupported = false;
    let uiHidden = false, frozen = false;
    let currentLens = 'main'; // 'main' or 'wide'
    let allDevices = [];
    let hasMultipleCams = false;
    let zoomMin = 1, zoomMax = 1;

    // Drawing
    let drawColor = '#ff3b30', drawSize = 3;
    let isEraser = false, isDrawing = false;
    let lastX = 0, lastY = 0;
    let drawHistory = [];

    // ═══════════════════════════════
    //  INIT
    // ═══════════════════════════════
    function init() {
        powerBtn.addEventListener('click', toggleCamera);
        freezeBtn.addEventListener('click', toggleFreeze);
        torchBtn.addEventListener('click', toggleTorch);
        fullscreenBtn.addEventListener('click', toggleFullscreen);
        hideUIBtn.addEventListener('click', hideUI);
        restoreBtn.addEventListener('click', showUI);
        unfreezeBtn.addEventListener('click', unfreeze);
        errorRetry.addEventListener('click', () => { closeError(); toggleCamera(); });

        lensMain.addEventListener('click', () => switchLens('main'));
        lensWide.addEventListener('click', () => switchLens('wide'));

        zoomSlider.addEventListener('input', onZoomChange);

        document.addEventListener('fullscreenchange', updateFSIcon);
        document.addEventListener('webkitfullscreenchange', updateFSIcon);

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') { e.preventDefault(); toggleUI(); }
            if (e.code === 'Escape' && !document.fullscreenElement) {
                if (frozen) unfreeze();
                else if (uiHidden) showUI();
            }
            if (e.code === 'KeyF' && stream && !frozen) { e.preventDefault(); toggleTorch(); }
            if (e.code === 'KeyG' && stream) { e.preventDefault(); toggleFreeze(); }
            if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && frozen) { e.preventDefault(); undoDraw(); }
        });

        // Double-tap
        let lastTap = 0;
        document.addEventListener('touchend', (e) => {
            if (frozen && e.target === drawCanvas) return;
            const now = Date.now();
            if (now - lastTap < 300) { e.preventDefault(); toggleUI(); }
            lastTap = now;
        });

        // Drawing toolbar events
        drawColorsEl.addEventListener('click', (e) => {
            const s = e.target.closest('.color-swatch');
            if (!s) return;
            drawColorsEl.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
            s.classList.add('active');
            drawColor = s.dataset.color;
            isEraser = false;
            eraserBtn.classList.remove('active');
        });
        drawSizesEl.addEventListener('click', (e) => {
            const b = e.target.closest('.size-btn');
            if (!b) return;
            drawSizesEl.querySelectorAll('.size-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            drawSize = parseInt(b.dataset.size, 10);
        });
        eraserBtn.addEventListener('click', () => {
            isEraser = !isEraser;
            eraserBtn.classList.toggle('active', isEraser);
        });
        undoBtn.addEventListener('click', undoDraw);
        clearDrawBtn.addEventListener('click', clearDraw);

        // Drawing: mouse
        drawCanvas.addEventListener('mousedown', startDraw);
        drawCanvas.addEventListener('mousemove', draw);
        drawCanvas.addEventListener('mouseup', endDraw);
        drawCanvas.addEventListener('mouseleave', endDraw);
        // Drawing: touch
        drawCanvas.addEventListener('touchstart', startDrawTouch, { passive: false });
        drawCanvas.addEventListener('touchmove', drawTouch, { passive: false });
        drawCanvas.addEventListener('touchend', endDraw);
        drawCanvas.addEventListener('touchcancel', endDraw);

        checkFSSupport();
        enumerateCameras();
    }

    // ═══════════════════════════════
    //  CAMERA
    // ═══════════════════════════════
    async function enumerateCameras() {
        try {
            const devs = await navigator.mediaDevices.enumerateDevices();
            allDevices = devs.filter(d => d.kind === 'videoinput');
            hasMultipleCams = allDevices.length > 1;
            if (!hasMultipleCams) {
                lensWide.style.display = 'none';
            }
        } catch (_) { /* silent */ }
    }

    async function toggleCamera() {
        if (stream) { if (frozen) unfreeze(); stopCamera(); return; }
        await startCamera();
    }

    async function startCamera() {
        try {
            const facingMode = currentLens === 'wide'
                ? { exact: 'environment' }
                : { ideal: 'environment' };

            const constraints = {
                video: {
                    facingMode,
                    width: { ideal: 9999 }, height: { ideal: 9999 },
                    frameRate: { ideal: 60 },
                },
                audio: false
            };

            // For wide-angle, try to pick a specific device
            if (currentLens === 'wide' && hasMultipleCams) {
                const wideDevice = findWideAngleDevice();
                if (wideDevice) {
                    delete constraints.video.facingMode;
                    constraints.video.deviceId = { exact: wideDevice.deviceId };
                }
            }

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            track = stream.getVideoTracks()[0];
            video.srcObject = stream;
            await video.play();

            // Capabilities
            const caps = track.getCapabilities ? track.getCapabilities() : {};
            torchSupported = !!caps.torch;

            // Zoom
            if (caps.zoom) {
                zoomMin = caps.zoom.min || 1;
                zoomMax = caps.zoom.max || 1;
                zoomSlider.min = zoomMin;
                zoomSlider.max = zoomMax;
                zoomSlider.step = (zoomMax - zoomMin) > 20 ? 0.5 : 0.1;
                zoomSlider.value = track.getSettings().zoom || zoomMin;
                zoomSlider.disabled = false;
                updateZoomLabel();
            } else {
                zoomSlider.disabled = true;
                zoomLabel.textContent = '--';
            }

            // UI updates
            const s = track.getSettings();
            const fps = s.frameRate ? Math.round(s.frameRate) : '?';
            resText.textContent = `${s.width||'?'} × ${s.height||'?'} • ${fps}fps`;
            const lbl = track.label || '';
            camText.textContent = lbl.length > 25 ? lbl.substring(0, 23) + '…' : (lbl || 'الكاميرا الخلفية');

            powerBtn.classList.add('cam-active');
            freezeBtn.disabled = false;
            statusBadge.classList.add('active');
            statusText.textContent = 'الكاميرا مفعّلة';

            if (torchSupported) {
                torchBtn.disabled = false;
                torchBtn.classList.remove('unsupported');
            } else {
                torchBtn.disabled = true;
            }

            // Re-enumerate after first getUserMedia (labels become available)
            enumerateCameras();

        } catch (err) {
            console.error('Camera error:', err);
            handleError(err);
        }
    }

    function findWideAngleDevice() {
        // Heuristic: wide-angle cameras often have labels containing
        // "wide", "ultra", "0.5", or are at index 2+ in the device list
        const wide = allDevices.find(d =>
            /wide|ultra|0\.5|超广/i.test(d.label)
        );
        if (wide) return wide;
        // Fallback: if there are 3+ cameras, the last one is often ultra-wide
        if (allDevices.length >= 3) return allDevices[allDevices.length - 1];
        // If only 2 cameras, try the one that is NOT the current one
        if (allDevices.length === 2 && track) {
            const currentId = track.getSettings().deviceId;
            return allDevices.find(d => d.deviceId !== currentId);
        }
        return null;
    }

    async function switchLens(lens) {
        if (lens === currentLens && stream) return;
        currentLens = lens;
        lensMain.classList.toggle('active', lens === 'main');
        lensWide.classList.toggle('active', lens === 'wide');
        if (stream) {
            if (frozen) unfreeze();
            stopCamera();
            await startCamera();
        }
    }

    function onZoomChange() {
        if (!track) return;
        const val = parseFloat(zoomSlider.value);
        try {
            track.applyConstraints({ advanced: [{ zoom: val }] });
        } catch (_) {}
        updateZoomLabel();
    }

    function updateZoomLabel() {
        const v = parseFloat(zoomSlider.value);
        zoomLabel.textContent = v >= 10 ? `${Math.round(v)}×` : `${v.toFixed(1)}×`;
    }

    async function toggleTorch() {
        if (!track || !torchSupported) return;
        try {
            torchOn = !torchOn;
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            torchBtn.classList.toggle('torch-active', torchOn);
            if (torchOn) statusText.textContent = 'الكاميرا + الفلاش';
            else if (!frozen) statusText.textContent = 'الكاميرا مفعّلة';
        } catch (e) {
            console.warn('Torch error:', e);
            torchOn = false;
        }
    }

    function stopCamera() {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null; track = null;
        torchOn = false; torchSupported = false;
        video.srcObject = null;
        powerBtn.classList.remove('cam-active');
        torchBtn.classList.remove('torch-active');
        freezeBtn.disabled = true; torchBtn.disabled = true;
        statusBadge.classList.remove('active');
        statusText.textContent = 'غير متصل';
        resText.textContent = '--';
        camText.textContent = 'الكاميرا الخلفية';
        zoomSlider.disabled = true;
        zoomLabel.textContent = '--';
    }

    // ═══════════════════════════════
    //  FREEZE
    // ═══════════════════════════════
    function toggleFreeze() {
        if (!stream) return;
        frozen ? unfreeze() : freeze();
    }

    function freeze() {
        if (!stream || !track) return;
        const vw = video.videoWidth, vh = video.videoHeight;
        freezeCanvas.width = vw; freezeCanvas.height = vh;
        freezeCtx.drawImage(video, 0, 0, vw, vh);
        drawCanvas.width = vw; drawCanvas.height = vh;
        drawCtx.clearRect(0, 0, vw, vh);

        freezeCanvas.classList.add('visible');
        drawCanvas.classList.add('visible');
        drawToolbar.classList.add('visible');

        // Hide everything else
        uiOverlay.classList.add('hidden');
        sideControls.style.display = 'none';
        zoomControls.style.display = 'none';

        frozen = true;
        freezeBtn.classList.add('freeze-active');
        drawHistory = [];
        isDrawing = false;
    }

    function unfreeze() {
        freezeCanvas.classList.remove('visible');
        drawCanvas.classList.remove('visible');
        drawToolbar.classList.remove('visible');

        // Restore UI
        uiOverlay.classList.remove('hidden');
        sideControls.style.display = '';
        zoomControls.style.display = '';

        frozen = false;
        freezeBtn.classList.remove('freeze-active');

        if (stream) {
            statusText.textContent = torchOn ? 'الكاميرا + الفلاش' : 'الكاميرا مفعّلة';
        }
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        drawHistory = [];
    }

    // ═══════════════════════════════
    //  DRAWING
    // ═══════════════════════════════
    function getPos(e) {
        const r = drawCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (drawCanvas.width / r.width),
            y: (e.clientY - r.top) * (drawCanvas.height / r.height)
        };
    }

    function startDraw(e) {
        if (!frozen) return;
        isDrawing = true;
        const p = getPos(e);
        lastX = p.x; lastY = p.y;
        drawHistory.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
        if (drawHistory.length > 50) drawHistory.shift();
    }

    function draw(e) {
        if (!isDrawing || !frozen) return;
        const p = getPos(e);
        drawCtx.beginPath();
        drawCtx.moveTo(lastX, lastY);
        drawCtx.lineTo(p.x, p.y);
        if (isEraser) {
            drawCtx.globalCompositeOperation = 'destination-out';
            drawCtx.strokeStyle = 'rgba(0,0,0,1)';
            drawCtx.lineWidth = drawSize * 4;
        } else {
            drawCtx.globalCompositeOperation = 'source-over';
            drawCtx.strokeStyle = drawColor;
            drawCtx.lineWidth = drawSize;
        }
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';
        drawCtx.stroke();
        lastX = p.x; lastY = p.y;
    }

    function endDraw() { isDrawing = false; }

    function startDrawTouch(e) {
        if (!frozen) return;
        e.preventDefault();
        startDraw(e.touches[0]);
    }
    function drawTouch(e) {
        if (!frozen || !isDrawing) return;
        e.preventDefault();
        draw(e.touches[0]);
    }

    function undoDraw() {
        if (!drawHistory.length) return;
        drawCtx.putImageData(drawHistory.pop(), 0, 0);
    }
    function clearDraw() {
        drawHistory.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }

    // ═══════════════════════════════
    //  UI
    // ═══════════════════════════════
    function toggleUI() {
        uiHidden ? showUI() : hideUI();
    }
    function hideUI() {
        uiOverlay.classList.add('hidden');
        sideControls.style.opacity = '0';
        sideControls.style.pointerEvents = 'none';
        zoomControls.style.opacity = '0';
        zoomControls.style.pointerEvents = 'none';
        restoreBtn.classList.add('visible');
        if (frozen) drawToolbar.classList.add('toolbar-hidden');
        uiHidden = true;
        setTimeout(() => { if (uiHidden) restoreBtn.style.opacity = '0.3'; }, 3000);
    }
    function showUI() {
        uiOverlay.classList.remove('hidden');
        sideControls.style.opacity = '';
        sideControls.style.pointerEvents = '';
        zoomControls.style.opacity = '';
        zoomControls.style.pointerEvents = '';
        restoreBtn.classList.remove('visible');
        restoreBtn.style.opacity = '';
        if (frozen) drawToolbar.classList.remove('toolbar-hidden');
        uiHidden = false;
    }

    // ═══════════════════════════════
    //  FULLSCREEN
    // ═══════════════════════════════
    function isFS() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    }
    function toggleFullscreen() {
        if (!isFS()) {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen().catch(()=>{});
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            else if (el.msRequestFullscreen) el.msRequestFullscreen();
            else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen().catch(()=>{});
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            else if (document.msExitFullscreen) document.msExitFullscreen();
        }
    }
    function updateFSIcon() {
        const fs = isFS();
        fsExpand.style.display = fs ? 'none' : '';
        fsCompress.style.display = fs ? '' : 'none';
        fullscreenBtn.classList.toggle('active', fs);
    }
    function checkFSSupport() {
        const el = document.documentElement;
        if (!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || video.webkitEnterFullscreen)) {
            fullscreenBtn.style.display = 'none';
        }
    }

    // ═══════════════════════════════
    //  ERROR
    // ═══════════════════════════════
    function handleError(err) {
        let t = 'خطأ في الكاميرا', m = 'حدث خطأ غير متوقع.';
        if (err.name === 'NotAllowedError') { t = 'الإذن مطلوب'; m = 'يرجى السماح بالوصول إلى الكاميرا.'; }
        else if (err.name === 'NotFoundError') { t = 'لا توجد كاميرا'; m = 'لم يتم اكتشاف كاميرا.'; }
        else if (err.name === 'NotReadableError') { t = 'الكاميرا مشغولة'; m = 'أغلق التطبيقات الأخرى وأعد المحاولة.'; }
        else if (err.name === 'OverconstrainedError') { t = 'خطأ في الإعدادات'; m = 'الكاميرا لا تدعم الإعدادات المطلوبة.'; }
        errorTitle.textContent = t;
        errorMessage.textContent = m;
        errorModal.classList.add('visible');
    }
    function closeError() { errorModal.classList.remove('visible'); }

    window.addEventListener('beforeunload', stopCamera);
    init();
})();
