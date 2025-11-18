// 引入 Three.js
import * as THREE from "https://esm.sh/three";

// 全域變數：基本渲染與 XR 會話狀態
let camera, scene, renderer;
let session = null;
let refSpace = null;
let markers = [];
let markerCount = 0;
let savedMarkers = [];

// Image Tracking 相關變數
let currentMode = null;
let referenceImage = null;
let imageAnchor = null;
let imageOrientation = null; // 新增：記錄圖片的旋轉方向

const startButton = document.getElementById('startButton');
const placeMarkerButton = document.getElementById('placeMarkerButton');
const saveButton = document.getElementById('saveButton');
const clearButton = document.getElementById('clearButton');
const info = document.getElementById('info');
const markerCountDiv = document.getElementById('markerCount');

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
            
            if (!db.objectStoreNames.contains(STORE_MARKERS)) {
                db.createObjectStore(STORE_MARKERS, { keyPath: 'id' });
                log('Created markers object store');
            }
            
            if (!db.objectStoreNames.contains(STORE_IMAGE)) {
                db.createObjectStore(STORE_IMAGE, { keyPath: 'id' });
                log('Created image object store');
            }
        };
    });
}

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

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    
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

function createMarker(label = '') {
    const group = new THREE.Group();

    const color = new THREE.Color(Math.random(), Math.random(), Math.random());
    const circleGeometry = new THREE.CircleGeometry(0.22, 32);
    const circleMaterial = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
    });
    const circle = new THREE.Mesh(circleGeometry, circleMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = -0.01;
    circle.position.z = -0.01;
    group.add(circle);

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
    textMesh.position.z = 0.01;
    group.add(textMesh);

    return group;
}

function placeMarker() {
    if (!session || !refSpace) {
        log('Session or refSpace not available');
        info.textContent = '請先啟動 AR 模式';
        return;
    }

    if (!imageAnchor) {
        info.textContent = '⚠️ 請先對準參考圖片，等待追蹤成功';
        return;
    }

    markerCount++;
    
    // 在腳下放置訊號點
    const markerPosition = camera.position.clone();
    markerPosition.y = camera.position.y - 1.6;

    const coordLabel = `#${markerCount}`;
    const marker = createMarker(coordLabel);
    marker.position.copy(markerPosition);
    marker.userData.index = markerCount;
    marker.userData.absolutePosition = markerPosition.clone();
    
    scene.add(marker);
    markers.push(marker);
    
    updateMarkerCount();
    info.textContent = `已放置訊號點 ${coordLabel}`;
    log(`Marker ${markerCount} placed at (${markerPosition.x.toFixed(3)}, ${markerPosition.y.toFixed(3)}, ${markerPosition.z.toFixed(3)})`);
}

function updateMarkerCount() {
    markerCountDiv.textContent = `訊號點數量: ${markerCount}`;
    
    if (markerCount > 0 && session) {
        saveButton.style.display = 'inline-block';
        clearButton.style.display = 'inline-block';
    } else {
        saveButton.style.display = 'none';
        clearButton.style.display = 'none';
    }
}

// 修正：正確計算相對位置
async function saveAllMarkers() {
    if (markers.length === 0) {
        info.textContent = '❌ 沒有訊號點可以儲存';
        return;
    }

    if (!imageAnchor) {
        info.textContent = '❌ 必須先對準參考圖片才能儲存';
        return;
    }

    log(`=== 開始儲存 ===`);
    log(`Image Anchor: (${imageAnchor.x.toFixed(3)}, ${imageAnchor.y.toFixed(3)}, ${imageAnchor.z.toFixed(3)})`);
    
    // 建立圖片座標系的逆矩陣
    const imageMatrix = new THREE.Matrix4();
    imageMatrix.setPosition(imageAnchor);
    if (imageOrientation) {
        imageMatrix.makeRotationFromQuaternion(imageOrientation);
        imageMatrix.setPosition(imageAnchor);
    }
    const imageMatrixInverse = imageMatrix.clone().invert();

    // 計算每個訊號點相對於圖片的局部座標
    savedMarkers = markers.map((marker) => {
        const worldPos = marker.userData.absolutePosition || marker.position;
        
        // 轉換到圖片的局部座標系
        const localPos = worldPos.clone().applyMatrix4(imageMatrixInverse);
        
        log(`Marker #${marker.userData.index}:`);
        log(`  World: (${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}, ${worldPos.z.toFixed(3)})`);
        log(`  Local: (${localPos.x.toFixed(3)}, ${localPos.y.toFixed(3)}, ${localPos.z.toFixed(3)})`);
        
        return {
            id: marker.userData.index,
            label: `#${marker.userData.index}`,
            localPosition: {
                x: localPos.x,
                y: localPos.y,
                z: localPos.z
            },
            timestamp: new Date().toISOString()
        };
    });
    
    // 儲存到 IndexedDB
    try {
        await saveToIndexedDB(STORE_MARKERS, {
            id: 'current',
            markers: savedMarkers,
            timestamp: new Date().toISOString()
        });
        
        if (referenceImage) {
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
        log(`Successfully saved ${savedMarkers.length} markers`);
    } catch (e) {
        info.textContent = '❌ 儲存失敗：' + e.message;
        log('Save error: ' + e.message);
    }
    
    updateMarkerCount();
}

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
        
        if (referenceImage) {
            try {
                if (!sessionInit.requiredFeatures.includes('image-tracking')) {
                    sessionInit.requiredFeatures.push('image-tracking');
                }
                sessionInit.trackedImages = [{
                    image: referenceImage,
                    widthInMeters: 0.3
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
            
            markers.forEach(marker => scene.remove(marker));
            markers = [];
            markerCount = 0;
            
            session = null;
            refSpace = null;
            imageAnchor = null;
            imageOrientation = null;
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

function render(timestamp, frame) {
    if (frame && refSpace) {
        const pose = frame.getViewerPose(refSpace);
        if (pose) {
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
                                    transform.orientation.x,
                                    transform.orientation.y,
                                    transform.orientation.z,
                                    transform.orientation.w
                                );
                                
                                const previousAnchor = imageAnchor;
                                imageAnchor = position;
                                imageOrientation = orientation; // 確保每次都更新
                                
                                trackingStatus.textContent = '✅ 已鎖定參考圖片';
                                trackingStatus.style.background = 'rgba(76,175,80,0.9)';
                                
                                // 第一次追蹤到
                                if (!previousAnchor) {
                                    log(`=== Image Tracked ===`);
                                    log(`Position: (${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)})`);
                                    log(`Orientation: (${orientation.x.toFixed(3)}, ${orientation.y.toFixed(3)}, ${orientation.z.toFixed(3)}, ${orientation.w.toFixed(3)})`);
                                    log(`Orientation magnitude: ${Math.sqrt(orientation.x**2 + orientation.y**2 + orientation.z**2 + orientation.w**2).toFixed(3)}`);
                                    
                                    if (currentMode === 'play' && markers.length === 0 && savedMarkers.length > 0) {
                                        restoreMarkers();
                                    }
                                } else {
                                    // 持續更新(調試用)
                                    if (Math.random() < 0.01) { // 1% 機率輸出,避免洗版
                                        log(`Tracking update: Orient=(${orientation.x.toFixed(3)}, ${orientation.y.toFixed(3)}, ${orientation.z.toFixed(3)}, ${orientation.w.toFixed(3)})`);
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
                        // 不要清空 imageAnchor 和 imageOrientation,保留最後的值
                        // imageAnchor = null;
                        // imageOrientation = null;
                    }
                } else {
                    trackingStatus.textContent = '🔍 尋找參考圖片中...';
                    trackingStatus.style.background = 'rgba(255,152,0,0.9)';
                }
            } catch (e) {
                log('Image tracking error: ' + e.message);
            }
        } else if (referenceImage && !frame.getImageTrackingResults) {
            if (trackingStatus.textContent.indexOf('不支援') === -1) {
                trackingStatus.textContent = '❌ 裝置不支援圖片追蹤';
                trackingStatus.style.background = 'rgba(244,67,54,0.9)';
                log('ERROR: Image tracking not supported by device');
            }
        }
    }
    renderer.render(scene, camera);
}

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

// 修正：使用局部座標系重現
function restoreMarkers() {
    if (!imageAnchor || savedMarkers.length === 0) {
        log('Cannot restore: imageAnchor=' + !!imageAnchor + ', savedMarkers=' + savedMarkers.length);
        return;
    }
    
    log(`=== 開始重現 ===`);
    log(`Image Anchor: (${imageAnchor.x.toFixed(3)}, ${imageAnchor.y.toFixed(3)}, ${imageAnchor.z.toFixed(3)})`);
    
    // 建立圖片的變換矩陣
    const imageMatrix = new THREE.Matrix4();
    imageMatrix.setPosition(imageAnchor);
    if (imageOrientation) {
        imageMatrix.makeRotationFromQuaternion(imageOrientation);
        imageMatrix.setPosition(imageAnchor);
        log(`Image Orientation: (${imageOrientation.x.toFixed(3)}, ${imageOrientation.y.toFixed(3)}, ${imageOrientation.z.toFixed(3)}, ${imageOrientation.w.toFixed(3)})`);
    }
    
    // 清除已存在的訊號點
    markers.forEach(marker => scene.remove(marker));
    markers = [];
    
    // 重現訊號點
    savedMarkers.forEach((data) => {
        const marker = createMarker(data.label);
        
        if (data.localPosition) {
            // 從局部座標轉換回世界座標
            const localPos = new THREE.Vector3(
                data.localPosition.x,
                data.localPosition.y,
                data.localPosition.z
            );
            const worldPosition = localPos.applyMatrix4(imageMatrix);
            
            marker.position.copy(worldPosition);
            marker.userData.absolutePosition = worldPosition.clone();
            marker.userData.index = data.id;
            
            log(`Restored Marker ${data.label}:`);
            log(`  Local: (${localPos.x.toFixed(3)}, ${localPos.y.toFixed(3)}, ${localPos.z.toFixed(3)})`);
            log(`  World: (${worldPosition.x.toFixed(3)}, ${worldPosition.y.toFixed(3)}, ${worldPosition.z.toFixed(3)})`);
            
            scene.add(marker);
            markers.push(marker);
        }
    });
    
    markerCount = markers.length;
    updateMarkerCount();
    info.textContent = `✅ 已重現 ${markers.length} 個訊號點`;
    log(`Successfully restored ${markers.length} markers`);
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
    
    try {
        const markersData = await loadFromIndexedDB(STORE_MARKERS, 'current');
        const imageData = await loadFromIndexedDB(STORE_IMAGE, 'current');
        
        if (!markersData || !imageData) {
            info.textContent = '❌ 沒有找到儲存的資料';
            modeSelection.style.display = 'block';
            return;
        }
        
        savedMarkers = markersData.markers || [];
        
        if (savedMarkers.length === 0) {
            info.textContent = '❌ 沒有找到訊號點資料';
            modeSelection.style.display = 'block';
            return;
        }
        
        referenceImage = await createImageBitmap(imageData.imageBlob);
        
        modeSelection.style.display = 'none';
        startButton.style.display = 'block';
        info.textContent = `✅ 已載入 ${savedMarkers.length} 個訊號點，對準參考圖片後開始 AR`;
        log(`Play mode: loaded ${savedMarkers.length} markers, image ${referenceImage.width}x${referenceImage.height}`);
        
    } catch (e) {
        info.textContent = '❌ 載入資料失敗：' + e.message;
        log('Load error: ' + e.message);
    }
});

// 事件監聽
startButton.addEventListener('click', startAR);
placeMarkerButton.addEventListener('click', placeMarker);
saveButton.addEventListener('click', saveAllMarkers);
clearButton.addEventListener('click', clearAllMarkers);

// 初始化
init();
initIndexedDB().then(() => {
    checkWebXRSupport();
}).catch(err => {
    log('IndexedDB initialization failed: ' + err.message);
    info.textContent = '❌ 資料庫初始化失敗，部分功能可能無法使用';
});
