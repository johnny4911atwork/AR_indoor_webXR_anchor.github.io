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
let imageAnchorMatrix = null;         // 圖片錨點的世界矩陣
let imageAnchorMatrixInverse = null;  // 圖片錨點矩陣的反矩陣

const startButton = document.getElementById('startButton');
const placeMarkerButton = document.getElementById('placeMarkerButton');
const saveButton = document.getElementById('saveButton');
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

// IndexedDB 相關變數
let db = null;
const DB_NAME = 'AR_Waypoints_DB';
const DB_VERSION = 1;
const STORE_MARKERS = 'markers';
const STORE_IMAGE = 'referenceImage';

// 簡單除錯輸出：僅同步到 console
function log(msg) {
    console.log(msg);
}

// 初始化 IndexedDB
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            log('IndexedDB error: ' + request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            log('IndexedDB initialized');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // 建立訊號點資料表
            if (!db.objectStoreNames.contains(STORE_MARKERS)) {
                db.createObjectStore(STORE_MARKERS, { keyPath: 'id' });
                log('Created markers object store');
            }
            
            // 建立參考圖片資料表
            if (!db.objectStoreNames.contains(STORE_IMAGE)) {
                db.createObjectStore(STORE_IMAGE, { keyPath: 'id' });
                log('Created image object store');
            }
        };
    });
}

// 儲存資料到 IndexedDB
function saveToIndexedDB(storeName, data) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// 從 IndexedDB 讀取資料
function loadFromIndexedDB(storeName, id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(id);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
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
    circle.position.y = -0.01;
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
    textMesh.position.y = 0.01;
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

    if (!imageAnchor && currentMode === 'record') {
        info.textContent = '⚠️ 請先對準參考圖片，等待追蹤成功';
        return;
    }

    markerCount++;
    const markerPosition = camera.position.clone();
    markerPosition.y = camera.position.y - 1.6; // 腳下約 1.6 米

    // 如果有圖片錨點，計算相對位置
    let relativePosition = markerPosition.clone();
    let relativeSpace = 'absolute';

    if (imageAnchorMatrixInverse) {
        relativePosition.applyMatrix4(imageAnchorMatrixInverse);
        relativeSpace = 'anchor-local';
    } else if (imageAnchor) {
        relativePosition.sub(imageAnchor);
        relativeSpace = 'world';
    }

    const coordLabel = `#${markerCount}`;
    const marker = createMarker(coordLabel);
    marker.position.copy(markerPosition);
    marker.userData.relativePosition = relativePosition; // 儲存相對位置
    marker.userData.relativeSpace = relativeSpace;
    
    scene.add(marker);
    markers.push(marker);
    
    updateMarkerCount();
    info.textContent = `已放置訊號點 ${coordLabel}`;
    log(`Marker ${markerCount} placed at (${marker.position.x.toFixed(2)}, ${marker.position.y.toFixed(2)}, ${marker.position.z.toFixed(2)})`);
    log(`Relative (${relativeSpace}) to anchor: (${relativePosition.x.toFixed(2)}, ${relativePosition.y.toFixed(2)}, ${relativePosition.z.toFixed(2)})`);
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
        relativePosition: {
            x: (marker.userData.relativePosition?.x ?? marker.position.x),
            y: (marker.userData.relativePosition?.y ?? marker.position.y),
            z: (marker.userData.relativePosition?.z ?? marker.position.z),
            space: marker.userData.relativeSpace || 'world'
        },
        label: `#${index + 1}`,
        timestamp: new Date().toISOString()
    }));

    savedMarkers = [...markerData];
    
    // 儲存到 IndexedDB
    try {
        // 儲存訊號點資料
        await saveToIndexedDB(STORE_MARKERS, {
            id: 'current',
            markers: savedMarkers,
            timestamp: new Date().toISOString()
        });
        
        // 如果有參考圖片，也儲存
        if (referenceImage) {
            // 將 ImageBitmap 轉換為 Blob
            const canvas = document.createElement('canvas');
            canvas.width = referenceImage.width;
            canvas.height = referenceImage.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(referenceImage, 0, 0);
            
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            
            await saveToIndexedDB(STORE_IMAGE, {
                id: 'current',
                imageBlob: blob,
                width: referenceImage.width,
                height: referenceImage.height,
                timestamp: new Date().toISOString()
            });
        }
        
        info.textContent = `✅ 已儲存 ${savedMarkers.length} 個訊號點`;
        log(`Saved ${savedMarkers.length} markers to IndexedDB`);
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
        
        // 如果有參考圖片，啟用 image-tracking（必須列在 requiredFeatures 才會啟用）
        if (referenceImage) {
            try {
                if (!sessionInit.requiredFeatures.includes('image-tracking')) {
                    sessionInit.requiredFeatures.push('image-tracking');
                }
                sessionInit.trackedImages = [{
                    image: referenceImage,
                    widthInMeters: 0.3 // 假設圖片寬度為 30cm（A4 紙大小）
                }];
                log('Image tracking configuration added');
                log(`Image size: ${referenceImage.width}x${referenceImage.height}`);
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
            
            // 移除所有訊號點
            markers.forEach(marker => scene.remove(marker));
            markers = [];
            markerCount = 0;
            
            session = null;
            refSpace = null;
            imageAnchor = null;
            imageAnchorMatrix = null;
            imageAnchorMatrixInverse = null;
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
        if (referenceImage && frame.getImageTrackingResults) {
            try {
                const results = frame.getImageTrackingResults();
                
                if (results && results.length > 0) {
                    let tracked = false;
                    
                    for (const result of results) {
                        const state = result.trackingState;
                        
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
                                const orientation = new THREE.Quaternion(
                                    transform.orientation?.x ?? 0,
                                    transform.orientation?.y ?? 0,
                                    transform.orientation?.z ?? 0,
                                    transform.orientation?.w ?? 1
                                );
                                
                                // 更新圖片錨點位置
                                const previousAnchor = imageAnchor;
                                imageAnchor = position.clone();
                                imageAnchorMatrix = new THREE.Matrix4().compose(
                                    imageAnchor.clone(),
                                    orientation.normalize(),
                                    new THREE.Vector3(1, 1, 1)
                                );
                                imageAnchorMatrixInverse = imageAnchorMatrix.clone().invert();
                                
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
                            log('Image tracking: emulated');
                        }
                    }
                    
                    if (!tracked) {
                        trackingStatus.textContent = '🔍 尋找參考圖片中...';
                        trackingStatus.style.background = 'rgba(255,152,0,0.9)';
                        imageAnchor = null;
                        imageAnchorMatrix = null;
                        imageAnchorMatrixInverse = null;
                    }
                } else {
                    trackingStatus.textContent = '🔍 尋找參考圖片中...';
                    trackingStatus.style.background = 'rgba(255,152,0,0.9)';
                    imageAnchorMatrix = null;
                    imageAnchorMatrixInverse = null;
                }
            } catch (e) {
                log('Image tracking error: ' + e.message);
            }
        } else if (referenceImage && !frame.getImageTrackingResults) {
            // 如果不支援 image tracking
            if (trackingStatus.textContent.indexOf('不支援') === -1) {
                trackingStatus.textContent = '❌ 裝置不支援圖片追蹤';
                trackingStatus.style.background = 'rgba(244,67,54,0.9)';
                log('ERROR: Image tracking not supported by device');
            }
            imageAnchorMatrix = null;
            imageAnchorMatrixInverse = null;
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
        let imageTrackingSupported = false;

        try {
            imageTrackingSupported = await navigator.xr.isSessionSupported('immersive-ar', {
                requiredFeatures: ['image-tracking']
            });
        } catch (featureErr) {
            log('Image tracking support check failed: ' + featureErr.message);
        }
        
        if (arSupported) {
            const trackingNote = imageTrackingSupported
                ? '（包含 Image Tracking）'
                : '（⚠️ 此裝置可能不支援 Image Tracking）';
            info.textContent = `✅ 您的裝置支援 AR ${trackingNote}`;
            modeSelection.style.display = 'block';
            if (!imageTrackingSupported) {
                log('AR supported but image tracking unavailable');
            } else {
                log('AR with image tracking is supported!');
            }
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
        const stored = data.relativePosition || {};
        const relativeSpace = stored.space || 'world';
        const relativeVector = new THREE.Vector3(
            stored.x ?? 0,
            stored.y ?? 0,
            stored.z ?? 0
        );
        let worldPosition;

        if (relativeSpace === 'anchor-local') {
            if (!imageAnchorMatrix) {
                log('⚠️ Anchor matrix missing, skipping anchor-local marker');
                return;
            }
            worldPosition = relativeVector.clone().applyMatrix4(imageAnchorMatrix);
        } else if (relativeSpace === 'world') {
            worldPosition = new THREE.Vector3(
                imageAnchor.x + relativeVector.x,
                imageAnchor.y + relativeVector.y,
                imageAnchor.z + relativeVector.z
            );
        } else {
            worldPosition = relativeVector.clone();
        }
        
        marker.position.copy(worldPosition);
        marker.userData.relativePosition = relativeVector.clone();
        marker.userData.relativeSpace = relativeSpace;
        
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
        
        // 建立 ImageBitmap（保留原始解析度）
        const img = new Image();
        img.onload = async () => {
            referenceImage = await createImageBitmap(img);
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
        const markersData = await loadFromIndexedDB(STORE_MARKERS, 'current');
        const imageData = await loadFromIndexedDB(STORE_IMAGE, 'current');
        
        if (!markersData || !imageData) {
            info.textContent = '❌ 沒有找到儲存的資料';
            modeSelection.style.display = 'block';
            return;
        }
        
        savedMarkers = markersData.markers;
        
        // 載入參考圖片（從 Blob 轉換為 ImageBitmap）
        referenceImage = await createImageBitmap(imageData.imageBlob);
        
        modeSelection.style.display = 'none';
        startButton.style.display = 'block';
        info.textContent = `✅ 已載入 ${savedMarkers.length} 個訊號點，對準參考圖片後開始 AR`;
        log(`Play mode: data loaded, image ${referenceImage.width}x${referenceImage.height}`);
        
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
initIndexedDB().then(() => {
    checkWebXRSupport();
}).catch(err => {
    log('IndexedDB initialization failed: ' + err.message);
    info.textContent = '❌ 資料庫初始化失敗，部分功能可能無法使用';
});
