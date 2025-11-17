// 引入 Three.js
import * as THREE from "https://esm.sh/three";

// 全域變數：基本渲染與 XR 會話狀態
let camera, scene, renderer;          // Three.js 基本場景與相機、渲染器
let session = null;                   // WebXR 目前的 AR 會話
let refSpace = null;                  // 參考座標空間 (viewer / local-floor 等)
let markers = [];                     // 已放置的訊號點物件集合
let markerCount = 0;                  // 訊號點累計數量
let savedMarkers = [];                // 儲存的訊號點資料

// Image Tracking 相關變數
let currentMode = null;               // 'record' 或 'play'
let referenceImage = null;            // 參考圖片的 Bitmap
let trackedImages = new Map();        // 追蹤到的圖片位置
let imageAnchor = null;               // 圖片錨點位置

const startButton = document.getElementById('startButton');
const placeMarkerButton = document.getElementById('placeMarkerButton');
const saveButton = document.getElementById('saveButton');
const downloadButton = document.getElementById('downloadButton');
const clearButton = document.getElementById('clearButton');
const info = document.getElementById('info');
const markerCountDiv = document.getElementById('markerCount');

// 新增的 UI 元素
const modeSelection = document.getElementById('modeSelection');
const recordModeButton = document.getElementById('recordModeButton');
const playModeButton = document.getElementById('playModeButton');
const imageUpload = document.getElementById('imageUpload');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const confirmImageButton = document.getElementById('confirmImageButton');
const cancelImageButton = document.getElementById('cancelImageButton');
const trackingStatus = document.getElementById('trackingStatus');

// 簡單除錯輸出：僅同步到 console
function log(msg) {
    console.log(msg);
}

// 初始化場景
// 初始化 Three.js 場景與基礎光源、XR 設定
function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    
    // 添加環境光
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    
    document.getElementById('container').appendChild(renderer.domElement);
    
    log('Three.js initialized');
}

// 創建訊號點標記
// 建立單一訊號點的 3D 造型 
function createMarker(label = '') {
    const group = new THREE.Group();

    const color = new THREE.Color(Math.random(), Math.random(), Math.random());
    const circleGeometry = new THREE.CircleGeometry(0.22, 32);
    const circleMaterial = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
        transparent: true, // 啟用透明
        opacity: 0.8       // 設定透明度
    });
    const circle = new THREE.Mesh(circleGeometry, circleMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0;
    circle.position.z = -0.01; // 圓形放在後面
    group.add(circle);

    // 編號文字平面
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'Bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const textMaterial = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true,
        side: THREE.DoubleSide
    });
    const textGeometry = new THREE.PlaneGeometry(0.3, 0.3);
    const textMesh = new THREE.Mesh(textGeometry, textMaterial);
    textMesh.position.y = 0;
    textMesh.rotation.x = -Math.PI / 2;
    textMesh.position.z = 0.01; // 文字放在前面
    group.add(textMesh);

    return group;
}

// 放置訊號點：以目前相機位置為基準，落在「腳下」高度
function placeMarker() {
    if (!session || !refSpace) {
        log('Session or refSpace not available');
        info.textContent = '請先啟動 AR 模式';
        return;
    }

    // 如果沒有追蹤到圖片但是記錄模式，給予警告
    if (!imageAnchor && currentMode === 'record') {
        info.textContent = '⚠️ 未追蹤到參考圖片，將使用絕對座標儲存（重現時可能不準確）';
    }

    markerCount++;
    const markerPosition = camera.position.clone();
    markerPosition.y = camera.position.y - 1.6; // 腳下約 1.6 米

    // 如果有圖片錨點，計算相對位置；否則使用絕對位置
    let relativePosition = markerPosition.clone();
    if (imageAnchor) {
        relativePosition = markerPosition.clone().sub(imageAnchor);
        log(`Saving with image anchor at (${imageAnchor.x.toFixed(2)}, ${imageAnchor.y.toFixed(2)}, ${imageAnchor.z.toFixed(2)})`);
    } else {
        log('No image anchor - saving absolute position');
    }

    const coordLabel = `#${markerCount}`;
    const marker = createMarker(coordLabel);
    marker.position.copy(markerPosition);
    marker.userData.relativePosition = relativePosition;
    marker.userData.hasAnchor = !!imageAnchor; // 記錄是否有錨點
    
    scene.add(marker);
    markers.push(marker);
    
    updateMarkerCount();
    info.textContent = `已放置訊號點 ${coordLabel}`;
    log(`Marker ${markerCount} placed at (${marker.position.x.toFixed(2)}, ${marker.position.y.toFixed(2)}, ${marker.position.z.toFixed(2)})`);
}

// 更新 UI 顯示目前訊號點數量
function updateMarkerCount() {
    markerCountDiv.textContent = `訊號點數量: ${markerCount}`;
    // 顯示/隱藏儲存按鈕
    if (markerCount > 0 && session) {
        saveButton.style.display = 'inline-block';
        clearButton.style.display = 'inline-block';
    } else {
        saveButton.style.display = 'none';
        clearButton.style.display = 'none';
    }
    // 顯示/隱藏下載按鈕
    if (savedMarkers.length > 0) {
        downloadButton.style.display = 'inline-block';
    } else {
        downloadButton.style.display = 'none';
    }
}

// 儲存所有訊號點
async function saveAllMarkers() {
    if (markers.length === 0) {
        info.textContent = '❌ 沒有訊號點可以儲存';
        return;
    }

    // 將目前的訊號點資料儲存（相對座標）
    const markerData = markers.map((marker, index) => ({
        id: index + 1,
        relativePosition: marker.userData.relativePosition || {
            x: marker.position.x,
            y: marker.position.y,
            z: marker.position.z
        },
        label: `#${index + 1}`,
        timestamp: new Date().toISOString()
    }));

    savedMarkers = [...markerData];
    
    // 儲存到 localStorage
    try {
        localStorage.setItem('ar_markers', JSON.stringify(savedMarkers));
        
        // 如果有參考圖片，也儲存
        if (referenceImage) {
            const canvas = document.createElement('canvas');
            canvas.width = referenceImage.width;
            canvas.height = referenceImage.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(referenceImage, 0, 0);
            const imageData = canvas.toDataURL('image/png');
            localStorage.setItem('ar_reference_image', imageData);
        }
        
        info.textContent = `✅ 已儲存 ${savedMarkers.length} 個訊號點`;
        log(`Saved ${savedMarkers.length} markers to localStorage`);
    } catch (e) {
        info.textContent = '❌ 儲存失敗：' + e.message;
        log('Save error: ' + e.message);
    }
    
    updateMarkerCount();
}

// 下載訊號點為 JSON 檔案
function downloadMarkersAsJSON() {
    if (savedMarkers.length === 0) {
        info.textContent = '❌ 沒有儲存的訊號點';
        return;
    }

    const dataStr = JSON.stringify(savedMarkers, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `markers_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    info.textContent = `📥 已下載 ${savedMarkers.length} 個訊號點`;
    log(`Downloaded ${savedMarkers.length} markers`);
}

// 清除所有訊號點
function clearAllMarkers() {
    if (confirm('確定要清除所有訊號點嗎？')) {
        markers.forEach(marker => scene.remove(marker));
        markers = [];
        markerCount = 0;
        updateMarkerCount();
        info.textContent = '✨ 已清除所有訊號點';
        log('All markers cleared');
    }
}

// 開始 AR 會話
// 啟動 AR：檢查支援、建立會話、選擇參考空間、啟動渲染迴圈
async function startAR() {
    log('Starting AR...');
    
    if (!navigator.xr) {
        info.textContent = '您的裝置不支援 WebXR';
        log('ERROR: WebXR not supported');
        return;
    }

    try {
        log('Requesting AR session...');
        
        const sessionInit = {
            requiredFeatures: ['dom-overlay'],
            domOverlay: { root: document.getElementById('container') },
            optionalFeatures: ['local-floor']
        };
        
        // 檢查並請求 image-tracking 功能
        if (referenceImage) {
            try {
                log('Checking image-tracking support...');
                
                // 先檢查是否支援 image-tracking
                let imageTrackingSupported = false;
                try {
                    imageTrackingSupported = await navigator.xr.isSessionSupported('immersive-ar', {
                        requiredFeatures: ['image-tracking']
                    });
                } catch (e) {
                    log('Image tracking support check failed: ' + e.message);
                }
                
                if (imageTrackingSupported) {
                    log('Image tracking is supported!');
                    sessionInit.requiredFeatures.push('image-tracking');
                } else {
                    log('Image tracking is NOT supported, adding to optionalFeatures');
                    sessionInit.optionalFeatures.push('image-tracking');
                }
                
                // 設定追蹤圖片
                sessionInit.trackedImages = [{
                    image: referenceImage,
                    widthInMeters: 0.3
                }];
                
                log('Image tracking configuration added');
                log(`Reference image size: ${referenceImage.width}x${referenceImage.height}px`);
            } catch (e) {
                log('Image tracking setup error: ' + e.message);
            }
        }
        
        session = await navigator.xr.requestSession('immersive-ar', sessionInit);
        log('AR session created');

        log('Setting XR session to renderer...');
        await renderer.xr.setSession(session);
        log('Renderer XR session set');

        // 嘗試不同的參考空間
        try {
            log('Trying local-floor...');
            refSpace = await session.requestReferenceSpace('local-floor');
            log('Using local-floor reference space');
        } catch (e) {
            log('local-floor failed, trying viewer...');
                refSpace = await session.requestReferenceSpace('viewer');
                log('Using viewer reference space');
        }

        session.addEventListener('end', () => {
            log('AR session ended');
            session = null;
            refSpace = null;
            imageAnchor = null;
            startButton.style.display = 'none';
            placeMarkerButton.style.display = 'none';
            saveButton.style.display = 'none';
            clearButton.style.display = 'none';
            markerCountDiv.style.display = 'none';
            trackingStatus.style.display = 'none';
            modeSelection.style.display = 'block';
            info.textContent = 'AR 已結束，請選擇模式';
        });

        startButton.style.display = 'none';
        markerCountDiv.style.display = 'block';
        updateMarkerCount();
        
        // 顯示追蹤狀態
        if (referenceImage) {
            trackingStatus.style.display = 'block';
            trackingStatus.textContent = '🔍 尋找參考圖片中...';
        }
        
        if (currentMode === 'record') {
            placeMarkerButton.style.display = 'block';
            info.textContent = '📍 對準參考圖片，然後移動放置訊號點';
        } else {
            placeMarkerButton.style.display = 'none';
            info.textContent = '🔍 對準參考圖片以顯示訊號點';
        }

        log('Starting animation loop...');
        renderer.setAnimationLoop(render);
        log('AR started successfully!');
    } catch (err) {
        info.textContent = 'AR 啟動失敗: ' + err.message;
        log('ERROR: ' + err.message);
        log('Stack: ' + err.stack);
    }
}

// 每一幀的渲染：更新相機姿態後繪製場景
function render(timestamp, frame) {
    if (frame && refSpace) {
        const pose = frame.getViewerPose(refSpace);
        if (pose) {
            // 更新相機位置以便放置標記時使用
            const view = pose.views[0];
            camera.matrix.fromArray(view.transform.matrix);
            camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
        }
        
        // 處理圖片追蹤
        if (referenceImage) {
            // 檢查是否有 getImageTrackingResults 方法
            if (typeof frame.getImageTrackingResults === 'function') {
                try {
                    const results = frame.getImageTrackingResults();
                    
                    log(`[Render] Tracking results count: ${results ? results.length : 0}`);
                    
                    if (results && results.length > 0) {
                        let tracked = false;
                        
                        for (let i = 0; i < results.length; i++) {
                            const result = results[i];
                            const state = result.trackingState;
                            
                            log(`[Render] Image ${i} state: ${state}`);
                            
                            if (state === 'tracked') {
                                tracked = true;
                                const imagePose = frame.getPose(result.imageSpace, refSpace);
                                
                                if (imagePose) {
                                    const transform = imagePose.transform;
                                    const position = new THREE.Vector3(
                                        transform.position.x,
                                        transform.position.y,
                                        transform.position.z
                                    );
                                    
                                    // 更新圖片錨點位置
                                    const previousAnchor = imageAnchor;
                                    imageAnchor = position;
                                    
                                    // 更新追蹤狀態顯示
                                    trackingStatus.textContent = '✅ 已鎖定參考圖片';
                                    trackingStatus.style.background = 'rgba(76,175,80,0.9)';
                                    
                                    // 如果是第一次追蹤到
                                    if (!previousAnchor) {
                                        log(`Image first tracked at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
                                        
                                        // 如果是播放模式，重現訊號點
                                        if (currentMode === 'play' && markers.length === 0 && savedMarkers.length > 0) {
                                            restoreMarkers();
                                        }
                                    }
                                }
                            } else if (state === 'emulated') {
                                tracked = true;
                                trackingStatus.textContent = '⚠️ 模擬追蹤中';
                                trackingStatus.style.background = 'rgba(255,152,0,0.9)';
                            }
                        }
                        
                        if (!tracked) {
                            trackingStatus.textContent = '🔍 尋找參考圖片中...';
                            trackingStatus.style.background = 'rgba(255,152,0,0.9)';
                            imageAnchor = null;
                        }
                    } else {
                        trackingStatus.textContent = '🔍 尋找參考圖片中...';
                        trackingStatus.style.background = 'rgba(255,152,0,0.9)';
                    }
                } catch (e) {
                    log('Image tracking error: ' + e.message);
                    trackingStatus.textContent = '❌ 追蹤錯誤：' + e.message;
                    trackingStatus.style.background = 'rgba(244,67,54,0.9)';
                }
            } else {
                log('[WARNING] frame.getImageTrackingResults is not available');
                if (trackingStatus.textContent.indexOf('不支援') === -1) {
                    trackingStatus.textContent = '❌ 裝置不支援圖片追蹤';
                    trackingStatus.style.background = 'rgba(244,67,54,0.9)';
                }
            }
        }
    }
    renderer.render(scene, camera);
}

// 檢查 WebXR 支援
// 啟動前檢查裝置與瀏覽器是否支援 WebXR AR 會話
async function checkWebXRSupport() {
    if (!navigator.xr) {
        info.textContent = '❌ 您的瀏覽器不支援 WebXR';
        log('WebXR not available');
        return;
    }

    log('WebXR available, checking AR support...');
    
    try {
        const arSupported = await navigator.xr.isSessionSupported('immersive-ar');
        
        if (arSupported) {
            info.textContent = '✅ 您的裝置支援 AR';
            modeSelection.style.display = 'block';
            log('AR is supported!');
        } else {
            info.textContent = '❌ 您的裝置不支援 AR 模式';
            log('AR not supported on this device');
        }
    } catch (err) {
        info.textContent = '❌ 檢查 AR 支援時發生錯誤';
        log('ERROR checking AR support: ' + err.message);
    }
}

// 重現儲存的訊號點
function restoreMarkers() {
    if (!imageAnchor || savedMarkers.length === 0) return;
    
    log('Restoring markers...');
    
    savedMarkers.forEach((data) => {
        const marker = createMarker(data.label);
        
        // 使用相對位置加上圖片錨點位置
        const worldPosition = new THREE.Vector3(
            imageAnchor.x + data.relativePosition.x,
            imageAnchor.y + data.relativePosition.y,
            imageAnchor.z + data.relativePosition.z
        );
        
        marker.position.copy(worldPosition);
        marker.userData.relativePosition = new THREE.Vector3(
            data.relativePosition.x,
            data.relativePosition.y,
            data.relativePosition.z
        );
        
        scene.add(marker);
        markers.push(marker);
    });
    
    markerCount = markers.length;
    updateMarkerCount();
    info.textContent = `✅ 已重現 ${markers.length} 個訊號點`;
    log(`Restored ${markers.length} markers`);
}

// 圖片上傳處理
imageInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        imagePreview.src = e.target.result;
        imagePreview.style.display = 'block';
        confirmImageButton.style.display = 'inline-block';
        
        // 建立 ImageBitmap
        const img = new Image();
        img.onload = async () => {
            // 調整圖片大小以提高追蹤效果
            const maxSize = 512;
            let width = img.width;
            let height = img.height;
            
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = (height / width) * maxSize;
                    width = maxSize;
                } else {
                    width = (width / height) * maxSize;
                    height = maxSize;
                }
            }
            
            referenceImage = await createImageBitmap(img, {
                resizeWidth: Math.floor(width),
                resizeHeight: Math.floor(height),
                resizeQuality: 'high'
            });
            
            log(`Reference image loaded: ${referenceImage.width}x${referenceImage.height}`);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

confirmImageButton.addEventListener('click', () => {
    if (!referenceImage) {
        info.textContent = '請先選擇圖片';
        return;
    }
    imageUpload.style.display = 'none';
    startButton.style.display = 'block';
    info.textContent = '✅ 參考圖片已設定，點擊開始 AR';
});

cancelImageButton.addEventListener('click', () => {
    imageUpload.style.display = 'none';
    modeSelection.style.display = 'block';
    referenceImage = null;
    imagePreview.style.display = 'none';
    confirmImageButton.style.display = 'none';
    imageInput.value = '';
});

recordModeButton.addEventListener('click', () => {
    currentMode = 'record';
    modeSelection.style.display = 'none';
    imageUpload.style.display = 'block';
    info.textContent = '📸 請拍攝作為參考點的圖片';
    log('Record mode selected');
});

playModeButton.addEventListener('click', async () => {
    currentMode = 'play';
    
    // 載入儲存的資料
    try {
        const markersData = localStorage.getItem('ar_markers');
        const imageData = localStorage.getItem('ar_reference_image');
        
        if (!markersData || !imageData) {
            info.textContent = '❌ 沒有找到儲存的資料';
            modeSelection.style.display = 'block';
            return;
        }
        
        savedMarkers = JSON.parse(markersData);
        
        // 載入參考圖片
        const img = new Image();
        img.onload = async () => {
            // 調整圖片大小以提高追蹤效果
            const maxSize = 512;
            let width = img.width;
            let height = img.height;
            
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = (height / width) * maxSize;
                    width = maxSize;
                } else {
                    width = (width / height) * maxSize;
                    height = maxSize;
                }
            }
            
            referenceImage = await createImageBitmap(img, {
                resizeWidth: Math.floor(width),
                resizeHeight: Math.floor(height),
                resizeQuality: 'high'
            });
            
            modeSelection.style.display = 'none';
            startButton.style.display = 'block';
            info.textContent = `✅ 已載入 ${savedMarkers.length} 個訊號點，對準參考圖片後開始 AR`;
            log(`Play mode: data loaded, image ${referenceImage.width}x${referenceImage.height}`);
        };
        img.src = imageData;
        
    } catch (e) {
        info.textContent = '❌ 載入資料失敗：' + e.message;
        log('Load error: ' + e.message);
    }
});

// 事件監聽
startButton.addEventListener('click', startAR);
placeMarkerButton.addEventListener('click', placeMarker);
saveButton.addEventListener('click', saveAllMarkers);
downloadButton.addEventListener('click', downloadMarkersAsJSON);
clearButton.addEventListener('click', clearAllMarkers);

// 初始化
init();
checkWebXRSupport();
