/**
 * Flashlight App — Mobile-First
 * Camera, zoom, wide-angle, freeze+draw, torch
 * All UI panels are independent fixed elements
 */
(function(){
'use strict';

// DOM
const video      = document.getElementById('cameraFeed');
const frzCanvas  = document.getElementById('freezeCanvas');
const drawCanvas = document.getElementById('drawCanvas');
const topBar     = document.getElementById('topBar');
const rightPanel = document.getElementById('rightPanel');
const leftPanel  = document.getElementById('leftPanel');
const bottomBar  = document.getElementById('bottomBar');
const powerBtn   = document.getElementById('powerBtn');
const freezeBtn  = document.getElementById('freezeBtn');
const torchBtn   = document.getElementById('torchBtn');
const hideUIBtn  = document.getElementById('hideUIBtn');
const restoreBtn = document.getElementById('restoreBtn');
const statusBadge= document.getElementById('statusBadge');
const statusText = statusBadge.querySelector('.status-text');
const resText    = document.getElementById('resolutionText');
const camText    = document.getElementById('cameraText');
const errorModal = document.getElementById('errorModal');
const errorTitle = document.getElementById('errorTitle');
const errorMsg   = document.getElementById('errorMessage');
const errorRetry = document.getElementById('errorRetryBtn');
const fsBtn      = document.getElementById('fullscreenBtn');
const fsExpand   = fsBtn.querySelector('.fs-expand');
const fsCompress = fsBtn.querySelector('.fs-compress');
const drawBar    = document.getElementById('drawToolbar');
const colorsEl   = document.getElementById('drawColors');
const sizesEl    = document.getElementById('drawSizes');
const eraserBtn  = document.getElementById('eraserBtn');
const undoBtn    = document.getElementById('undoBtn');
const clearBtn   = document.getElementById('clearDrawBtn');
const unfreezeBtn= document.getElementById('unfreezeBtn');
const zoomSlider = document.getElementById('zoomSlider');
const zoomLabel  = document.getElementById('zoomLabel');
const lensMain   = document.getElementById('lensMain');
const lensWide   = document.getElementById('lensWide');

const frzCtx  = frzCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');

// State
let stream=null, track=null;
let torchOn=false, torchSupported=false;
let uiHidden=false, frozen=false;
let currentLens='main';
let allDevices=[], hasMultiCam=false;

// Drawing
let dColor='#ff3b30', dSize=3, isEraser=false, drawing=false;
let points=[];  // collected points for smooth curves
let lx=0, ly=0, dHistory=[];

// ═══════════════════════════
//  INIT
// ═══════════════════════════
function init(){
    powerBtn.addEventListener('click', toggleCamera);
    freezeBtn.addEventListener('click', toggleFreeze);
    torchBtn.addEventListener('click', toggleTorch);
    fsBtn.addEventListener('click', toggleFS);
    hideUIBtn.addEventListener('click', hideUI);
    restoreBtn.addEventListener('click', showUI);
    unfreezeBtn.addEventListener('click', unfreeze);
    errorRetry.addEventListener('click', ()=>{ closeErr(); toggleCamera(); });

    lensMain.addEventListener('click', ()=>switchLens('main'));
    lensWide.addEventListener('click', ()=>switchLens('wide'));
    zoomSlider.addEventListener('input', onZoom);

    document.addEventListener('fullscreenchange', updateFSIcon);
    document.addEventListener('webkitfullscreenchange', updateFSIcon);

    // Keys
    document.addEventListener('keydown', e=>{
        if(e.code==='Space'){e.preventDefault(); toggleUI();}
        if(e.code==='Escape'&&!document.fullscreenElement){
            if(frozen) unfreeze(); else if(uiHidden) showUI();
        }
        if(e.code==='KeyF'&&stream&&!frozen){e.preventDefault(); toggleTorch();}
        if(e.code==='KeyG'&&stream){e.preventDefault(); toggleFreeze();}
        if(e.code==='KeyZ'&&(e.ctrlKey||e.metaKey)&&frozen){e.preventDefault(); undo();}
    });

    // Double-tap
    let lastTap=0;
    document.addEventListener('touchend', e=>{
        if(frozen && (e.target===drawCanvas || drawBar.contains(e.target))) return;
        const now=Date.now();
        if(now-lastTap<300){e.preventDefault(); toggleUI();}
        lastTap=now;
    });

    // Draw toolbar
    colorsEl.addEventListener('click', e=>{
        const s=e.target.closest('.clr-dot'); if(!s) return;
        colorsEl.querySelectorAll('.clr-dot').forEach(x=>x.classList.remove('active'));
        s.classList.add('active');
        dColor=s.dataset.color; isEraser=false; eraserBtn.classList.remove('active');
    });
    sizesEl.addEventListener('click', e=>{
        const b=e.target.closest('.sz-btn'); if(!b) return;
        sizesEl.querySelectorAll('.sz-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        dSize=parseInt(b.dataset.size,10);
    });
    eraserBtn.addEventListener('click', ()=>{
        isEraser=!isEraser; eraserBtn.classList.toggle('active',isEraser);
    });
    undoBtn.addEventListener('click', undo);
    clearBtn.addEventListener('click', clearDraw);

    // Draw: mouse
    drawCanvas.addEventListener('mousedown', onDrawStart);
    drawCanvas.addEventListener('mousemove', onDraw);
    drawCanvas.addEventListener('mouseup', onDrawEnd);
    drawCanvas.addEventListener('mouseleave', onDrawEnd);
    // Draw: touch
    drawCanvas.addEventListener('touchstart', onTouchStart, {passive:false});
    drawCanvas.addEventListener('touchmove', onTouchMove, {passive:false});
    drawCanvas.addEventListener('touchend', onDrawEnd);
    drawCanvas.addEventListener('touchcancel', onDrawEnd);

    checkFS();
    enumCams();
}

// ═══════════════════════════
//  CAMERA
// ═══════════════════════════
async function enumCams(){
    try{
        const d=await navigator.mediaDevices.enumerateDevices();
        allDevices=d.filter(x=>x.kind==='videoinput');
        hasMultiCam=allDevices.length>1;
        // Always show wide lens button — user can try it
        // Only hide if we're certain there's exactly 1 camera AND labels are available
        if(allDevices.length===1 && allDevices[0].label){
            lensWide.style.display='none';
        } else {
            lensWide.style.display='';
        }
    }catch(_){}
}

async function toggleCamera(){
    if(stream){if(frozen) unfreeze(); stopCam(); return;}
    await startCam();
}

async function startCam(){
    try{
        const fm = currentLens==='wide' ? {exact:'environment'} : {ideal:'environment'};
        const c = {
            video:{facingMode:fm, width:{ideal:9999}, height:{ideal:9999}, frameRate:{ideal:60, min:30}},
            audio:false
        };
        if(currentLens==='wide' && hasMultiCam){
            const wd=findWide();
            if(wd){delete c.video.facingMode; c.video.deviceId={exact:wd.deviceId};}
        }

        stream=await navigator.mediaDevices.getUserMedia(c);
        track=stream.getVideoTracks()[0];
        video.srcObject=stream;
        await video.play();

        const caps=track.getCapabilities?track.getCapabilities():{};
        torchSupported=!!caps.torch;

        // Zoom
        if(caps.zoom){
            zoomSlider.min=caps.zoom.min||1;
            zoomSlider.max=caps.zoom.max||1;
            zoomSlider.step=(caps.zoom.max-caps.zoom.min)>20?.5:.1;
            zoomSlider.value=track.getSettings().zoom||caps.zoom.min||1;
            zoomSlider.disabled=false;
            updZoomLbl();
        }else{
            zoomSlider.disabled=true; zoomLabel.textContent='--';
        }

        const s=track.getSettings();
        const fps=s.frameRate?Math.round(s.frameRate):'?';
        resText.textContent=`${s.width||'?'}×${s.height||'?'} ${fps}fps`;
        const lbl=track.label||'';
        camText.textContent=lbl.length>22?lbl.substring(0,20)+'…':(lbl||'الكاميرا الخلفية');

        powerBtn.classList.add('c-on');
        freezeBtn.disabled=false;
        statusBadge.classList.add('on');
        statusText.textContent='الكاميرا مفعّلة';

        if(torchSupported){torchBtn.disabled=false;}
        else{torchBtn.disabled=true;}

        enumCams();
    }catch(err){
        console.error(err); handleErr(err);
    }
}

function findWide(){
    const w=allDevices.find(d=>/wide|ultra|0\.5|超广/i.test(d.label));
    if(w) return w;
    if(allDevices.length>=3) return allDevices[allDevices.length-1];
    if(allDevices.length===2&&track){
        const cur=track.getSettings().deviceId;
        return allDevices.find(d=>d.deviceId!==cur);
    }
    return null;
}

async function switchLens(lens){
    if(lens===currentLens&&stream) return;
    currentLens=lens;
    lensMain.classList.toggle('active',lens==='main');
    lensWide.classList.toggle('active',lens==='wide');
    if(stream){if(frozen) unfreeze(); stopCam(); await startCam();}
}

function onZoom(){
    if(!track) return;
    try{track.applyConstraints({advanced:[{zoom:parseFloat(zoomSlider.value)}]});}catch(_){}
    updZoomLbl();
}
function updZoomLbl(){
    const v=parseFloat(zoomSlider.value);
    zoomLabel.textContent=v>=10?Math.round(v)+'×':v.toFixed(1)+'×';
}

async function toggleTorch(){
    if(!track||!torchSupported) return;
    try{
        torchOn=!torchOn;
        await track.applyConstraints({advanced:[{torch:torchOn}]});
        torchBtn.classList.toggle('t-on',torchOn);
        if(!frozen) statusText.textContent=torchOn?'الكاميرا + الفلاش':'الكاميرا مفعّلة';
    }catch(e){torchOn=false;console.warn(e);}
}

function stopCam(){
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=null;track=null;torchOn=false;torchSupported=false;
    video.srcObject=null;
    powerBtn.classList.remove('c-on');
    torchBtn.classList.remove('t-on');
    freezeBtn.disabled=true;torchBtn.disabled=true;
    statusBadge.classList.remove('on');
    statusText.textContent='غير متصل';
    resText.textContent='--';camText.textContent='الكاميرا الخلفية';
    zoomSlider.disabled=true;zoomLabel.textContent='--';
}

// ═══════════════════════════
//  FREEZE
// ═══════════════════════════
function toggleFreeze(){
    if(!stream) return;
    frozen ? unfreeze() : freeze();
}

function freeze(){
    if(!stream||!track) return;
    const vw=video.videoWidth, vh=video.videoHeight;
    frzCanvas.width=vw; frzCanvas.height=vh;
    frzCtx.drawImage(video,0,0,vw,vh);
    drawCanvas.width=vw; drawCanvas.height=vh;
    drawCtx.clearRect(0,0,vw,vh);

    // Show frozen frame + draw surface
    frzCanvas.classList.add('on');
    drawCanvas.classList.add('on');

    // Show draw toolbar
    drawBar.classList.add('on');

    // Hide all other UI
    topBar.classList.add('hide');
    rightPanel.classList.add('hide');
    leftPanel.classList.add('hide');
    bottomBar.classList.add('hide');

    frozen=true;
    freezeBtn.classList.add('f-on');
    dHistory=[]; drawing=false;
}

function unfreeze(){
    frzCanvas.classList.remove('on');
    drawCanvas.classList.remove('on');
    drawBar.classList.remove('on');

    // Restore UI
    topBar.classList.remove('hide');
    rightPanel.classList.remove('hide');
    leftPanel.classList.remove('hide');
    bottomBar.classList.remove('hide');

    frozen=false;
    freezeBtn.classList.remove('f-on');
    if(stream) statusText.textContent=torchOn?'الكاميرا + الفلاش':'الكاميرا مفعّلة';
    drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
    dHistory=[];
}

// ═══════════════════════════
//  DRAWING
// ═══════════════════════════
function pos(e){
    const r=drawCanvas.getBoundingClientRect();
    return{
        x:(e.clientX-r.left)*(drawCanvas.width/r.width),
        y:(e.clientY-r.top)*(drawCanvas.height/r.height)
    };
}

function onDrawStart(e){
    if(!frozen) return; drawing=true;
    const p=pos(e);
    points=[p];
    lx=p.x; ly=p.y;
    dHistory.push(drawCtx.getImageData(0,0,drawCanvas.width,drawCanvas.height));
    if(dHistory.length>50) dHistory.shift();
}
function onDraw(e){
    if(!drawing||!frozen) return;
    const p=pos(e);
    points.push(p);

    // Setup brush
    if(isEraser){
        drawCtx.globalCompositeOperation='destination-out';
        drawCtx.strokeStyle='rgba(0,0,0,1)'; drawCtx.lineWidth=dSize*4;
    }else{
        drawCtx.globalCompositeOperation='source-over';
        drawCtx.strokeStyle=dColor; drawCtx.lineWidth=dSize;
    }
    drawCtx.lineCap='round'; drawCtx.lineJoin='round';

    if(points.length < 3){
        // Not enough points yet, draw a simple line
        drawCtx.beginPath();
        drawCtx.moveTo(lx,ly);
        drawCtx.lineTo(p.x,p.y);
        drawCtx.stroke();
    } else {
        // Smooth curve using quadratic bezier through midpoints
        // Redraw from last 3 points for smooth connection
        const len=points.length;
        const p0=points[len-3];
        const p1=points[len-2];
        const p2=points[len-1];
        const mid1={x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2};
        const mid2={x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
        drawCtx.beginPath();
        drawCtx.moveTo(mid1.x, mid1.y);
        drawCtx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
        drawCtx.stroke();
    }
    lx=p.x; ly=p.y;
}
function onDrawEnd(){
    // Draw final segment to the last point
    if(drawing && points.length>=2){
        const p1=points[points.length-2];
        const p2=points[points.length-1];
        drawCtx.beginPath();
        drawCtx.moveTo(p1.x,p1.y);
        drawCtx.lineTo(p2.x,p2.y);
        drawCtx.stroke();
    }
    drawing=false;
    points=[];
}

function onTouchStart(e){if(!frozen) return; e.preventDefault(); onDrawStart(e.touches[0]);}
function onTouchMove(e){if(!frozen||!drawing) return; e.preventDefault(); onDraw(e.touches[0]);}

function undo(){
    if(!dHistory.length) return;
    drawCtx.putImageData(dHistory.pop(),0,0);
}
function clearDraw(){
    dHistory.push(drawCtx.getImageData(0,0,drawCanvas.width,drawCanvas.height));
    drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
}

// ═══════════════════════════
//  UI TOGGLE
// ═══════════════════════════
function toggleUI(){uiHidden?showUI():hideUI();}
function hideUI(){
    topBar.classList.add('hide');
    rightPanel.classList.add('hide');
    leftPanel.classList.add('hide');
    bottomBar.classList.add('hide');
    if(frozen) drawBar.classList.remove('on');
    restoreBtn.classList.add('on');
    uiHidden=true;
    setTimeout(()=>{if(uiHidden) restoreBtn.style.opacity='.3';},3000);
}
function showUI(){
    if(!frozen){
        topBar.classList.remove('hide');
        rightPanel.classList.remove('hide');
        leftPanel.classList.remove('hide');
        bottomBar.classList.remove('hide');
    }
    if(frozen) drawBar.classList.add('on');
    restoreBtn.classList.remove('on');
    restoreBtn.style.opacity='';
    uiHidden=false;
}

// ═══════════════════════════
//  FULLSCREEN
// ═══════════════════════════
function isFullscreen(){return !!(document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement)}
function toggleFS(){
    if(!isFullscreen()){
        const el=document.documentElement;
        if(el.requestFullscreen) el.requestFullscreen().catch(()=>{});
        else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if(el.msRequestFullscreen) el.msRequestFullscreen();
        else if(video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }else{
        if(document.exitFullscreen) document.exitFullscreen().catch(()=>{});
        else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if(document.msExitFullscreen) document.msExitFullscreen();
    }
}
function updateFSIcon(){
    const f=isFullscreen();
    fsExpand.style.display=f?'none':'';
    fsCompress.style.display=f?'':'none';
    fsBtn.classList.toggle('on',f);
}
function checkFS(){
    const el=document.documentElement;
    if(!(el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen||video.webkitEnterFullscreen))
        fsBtn.style.display='none';
}

// ═══════════════════════════
//  ERROR
// ═══════════════════════════
function handleErr(err){
    let t='خطأ في الكاميرا', m='حدث خطأ غير متوقع.';
    if(err.name==='NotAllowedError'){t='الإذن مطلوب';m='يرجى السماح بالوصول إلى الكاميرا.';}
    else if(err.name==='NotFoundError'){t='لا توجد كاميرا';m='لم يتم اكتشاف كاميرا.';}
    else if(err.name==='NotReadableError'){t='الكاميرا مشغولة';m='أغلق التطبيقات الأخرى.';}
    else if(err.name==='OverconstrainedError'){t='خطأ';m='الكاميرا لا تدعم الإعدادات المطلوبة.';}
    errorTitle.textContent=t; errorMsg.textContent=m;
    errorModal.classList.add('on');
}
function closeErr(){errorModal.classList.remove('on');}

window.addEventListener('beforeunload', stopCam);
init();
})();
