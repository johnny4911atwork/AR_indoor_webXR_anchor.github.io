// 引入 Three.js
import * as THREE from "https://esm.sh/three";

// 全域變數：基本渲染與 XR 會話狀態
let camera, scene, renderer;          // Three.js 基本場景與相機、渲染器
let session = null;                   // WebXR 目前的 AR 會話
let refSpace = null;                  // 參考座標空間
let markers = [];                     // 已放置的訊號點物件集合(THREE.Group)
let anchors = [];                     // 對應的 XRAnchor 物件集合
let markerCount = 0;                  // 訊號點累計數量
let savedAnchorUUIDs = [];            // 儲存的錨點 UUID 列表
let pendingMarkerCreation = false;    // 標記是否需要在下一幀建立標記

const startButton = document.getElementById('startButton');
const placeMarkerButton = document.getElementById('placeMarkerButton');
const saveButton = document.getElementById('saveButton');
const clearButton = document.getElementById('clearButton');
const info = document.getElementById('info');
const markerCountDiv = document.getElementById('markerCount');
const anchorStatus = document.getElementById('anchorStatus');

// 簡單除錯輸出
function log(msg) {
    console.log(msg);
}

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
        transparent: true,
        opacity: 0.8
    });
    const circle = new THREE.Mesh(circleGeometry, circleMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.01;
    circle.position.z = -0.01;
    group.add(circle);

    // 編號文字平面
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'Bold 12px Arial';
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
    textMesh.position.y = -0.01;
    textMesh.rotation.x = -Math.PI / 2;
    textMesh.position.z = 0.01;
    group.add(textMesh);

    return group;
}

// 放置訊號點：標記待建立（會在下一幀的 XRFrame 回調中執行）
function placeMarker() {
    if (!session || !refSpace) {
        log('Session or refSpace not available');
        info.textContent = '請先啟動 AR 模式';
        return;
    }

    // 標記待建立，會在下一幀的 render 回調中執行
    pendingMarkerCreation = true;
    info.textContent = '正在建立錨點...';
    log('Marking marker for creation in next frame');
}

// 在 XRFrame 回調中建立錨點
async function createAnchorInFrame(frame) {
    if (!pendingMarkerCreation || !frame || !refSpace) return;
    
    try {
        markerCount++;
        
        // 建立錨點姿態
        const pose = new XRRigidTransform(
            {
                x: camera.position.x,
                y: camera.position.y - 1.2,
                z: camera.position.z
            },
            { x: 0, y: 0, z: 0, w: 1 }  // 預設旋轉
        );

        log(`Creating anchor at (${pose.position.x.toFixed(2)}, ${pose.position.y.toFixed(2)}, ${pose.position.z.toFixed(2)})`);

        // 在 XRFrame 中建立錨點
        const anchor = await frame.createAnchor(pose, refSpace);
        
        if (!anchor) {
            throw new Error('錨點建立失敗');
        }

        // 詳細 debug 資訊
        log(`Anchor created successfully`);
        log(`Anchor type: ${typeof anchor}`);
        log(`Anchor constructor: ${anchor.constructor.name}`);
        log(`Anchor properties: ${Object.getOwnPropertyNames(anchor)}`);
        log(`Has anchorSpace: ${!!anchor.anchorSpace}`);
        log(`Has requestPersistentHandle: ${typeof anchor.requestPersistentHandle}`);
        log(`Has delete: ${typeof anchor.delete}`);
        log(`Full anchor object:`, anchor);

        // 建立視覺標記
        const coordLabel = `#${markerCount}`;
        const marker = createMarker(coordLabel);
        scene.add(marker);
        
        markers.push(marker);
        anchors.push(anchor);
        
        updateMarkerCount();
        info.textContent = `✅ 已放置訊號點 #${markerCount}`;
        log(`Marker ${markerCount} placed successfully`);
        
    } catch (err) {
        info.textContent = `❌ 錨點建立失敗: ${err.message}`;
        log('ERROR creating anchor: ' + err.message);
        log('Stack: ' + err.stack);
        markerCount--;
    } finally {
        pendingMarkerCreation = false;
    }
}

// 更新錨點位置到視覺標記
function updateAnchorPoses(frame) {
    if (!frame || !refSpace) return;

    for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        const marker = markers[i];
        
        if (anchor && marker) {
            const anchorPose = frame.getPose(anchor.anchorSpace, refSpace);
            if (anchorPose) {
                marker.matrix.fromArray(anchorPose.transform.matrix);
                marker.matrix.decompose(marker.position, marker.quaternion, marker.scale);
            }
        }
    }
}

// 更新 UI 顯示目前訊號點數量
function updateMarkerCount() {
    markerCountDiv.textContent = `訊號點數量: ${markerCount}`;
    
    // 顯示/隱藏按鈕
    if (markerCount > 0 && session) {
        saveButton.style.display = 'inline-block';
        clearButton.style.display = 'inline-block';
    } else {
        saveButton.style.display = 'none';
        clearButton.style.display = 'none';
    }
}

// 儲存所有錨點 UUID
async function saveAllMarkers() {
    if (anchors.length === 0) {
        info.textContent = '❌ 沒有訊號點可以儲存';
        return;
    }

    info.textContent = '正在請求持久化錨點...';
    log('Requesting persistent handles for all anchors...');
    log(`Total anchors: ${anchors.length}`);

    try {
        // 使用官方規範：呼叫 requestPersistentHandle() 取得 UUID
        const uuidPromises = anchors.map(async (anchor, index) => {
            try {
                log(`Processing anchor ${index + 1}/${anchors.length}`);
                log(`Anchor type: ${typeof anchor}`);
                log(`Has requestPersistentHandle: ${typeof anchor.requestPersistentHandle}`);
                
                if (typeof anchor.requestPersistentHandle !== 'function') {
                    throw new Error(`requestPersistentHandle is not a function. Available methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(anchor))}`);
                }
                
                const uuid = await anchor.requestPersistentHandle();
                log(`Got UUID for anchor ${index + 1}: ${uuid}`);
                return {
                    uuid: uuid,
                    label: `訊號點 ${index + 1}`,
                    timestamp: new Date().toISOString()
                };
            } catch (err) {
                log(`ERROR getting UUID for anchor ${index + 1}: ${err.message}`);
                return null;
            }
        });

        const results = await Promise.all(uuidPromises);
        savedAnchorUUIDs = results.filter(item => item !== null);

        if (savedAnchorUUIDs.length === 0) {
            info.textContent = '❌ 無法取得任何錨點的持久化 UUID';
            return;
        }

        // 儲存到 localStorage
        localStorage.setItem('persistentAnchors', JSON.stringify(savedAnchorUUIDs));
        info.textContent = `✅ 已儲存 ${savedAnchorUUIDs.length} 個錨點 UUID`;
        log(`Saved ${savedAnchorUUIDs.length} anchor UUIDs to localStorage`);
        updateMarkerCount();
    } catch (err) {
        info.textContent = `❌ 儲存失敗: ${err.message}`;
        log('ERROR saving anchors: ' + err.message);
    }
}

// 清除所有訊號點
async function clearAllMarkers() {
    if (!confirm('確定要清除所有訊號點嗎？這也會清除已儲存的錨點。')) {
        return;
    }

    // 使用官方規範：呼叫 anchor.delete() 刪除錨點
    for (const anchor of anchors) {
        try {
            anchor.delete();
            log('Deleted anchor using anchor.delete()');
        } catch (err) {
            log(`Failed to delete anchor: ${err.message}`);
        }
    }

    // 刪除場景中的標記
    markers.forEach(marker => scene.remove(marker));
    markers = [];
    anchors = [];
    markerCount = 0;

    // 嘗試刪除持久化錨點（從 session 層級）
    if (session && session.deletePersistentAnchor && savedAnchorUUIDs.length > 0) {
        for (const data of savedAnchorUUIDs) {
            try {
                await session.deletePersistentAnchor(data.uuid);
                log(`Deleted persistent anchor from session: ${data.uuid}`);
            } catch (err) {
                log(`Failed to delete persistent anchor ${data.uuid}: ${err.message}`);
            }
        }
    }

    // 清除 localStorage
    localStorage.removeItem('persistentAnchors');
    savedAnchorUUIDs = [];

    updateMarkerCount();
    info.textContent = '✨ 已清除所有訊號點';
    log('All markers cleared');
}

// 啟動 AR：檢查支援、建立會話、選擇參考空間、啟動渲染迴圈
async function startAR() {
    log('Starting AR...');
    
    if (!navigator.xr) {
        info.textContent = '您的裝置不支援 WebXR';
        log('ERROR: WebXR not supported');
        return;
    }

    try {
        log('Requesting AR session with anchors support...');
        session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['dom-overlay', 'anchors'],  // 要求錨點支援
            domOverlay: { root: document.getElementById('container') },
            optionalFeatures: ['local-floor']
        });
        log('AR session created with anchors support');

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

        
        // 檢查持久化錨點 API 支援
        const supportsPersistent = session.restorePersistentAnchor && session.deletePersistentAnchor;
        
        if (supportsPersistent) {
            // 檢查 persistentAnchors 屬性並記錄現有持久化錨點
            let persistentList = [];
            try {
                persistentList = session.persistentAnchors || [];
                log(`session.persistentAnchors: ${JSON.stringify(persistentList)}`);
            } catch (err) {
                log(`ERROR accessing session.persistentAnchors: ${err.message}`);
            }
            
            anchorStatus.textContent = `✅ 支援持久化錨點 (現有: ${persistentList.length})`;
            anchorStatus.style.display = 'block';
            log(`Persistent anchors supported. Existing: ${persistentList.length}`);
        } else {
            anchorStatus.textContent = '⚠️ 不支援持久化錨點（錨點僅在本次 session 有效）';
            anchorStatus.style.display = 'block';
            log('WARNING: Persistent anchors not supported');
        }

        session.addEventListener('end', () => {
            log('AR session ended');
            session = null;
            refSpace = null;
            startButton.style.display = 'block';
            placeMarkerButton.style.display = 'none';
            saveButton.style.display = 'none';
            clearButton.style.display = 'none';
            markerCountDiv.style.display = 'none';
            anchorStatus.style.display = 'none';
            info.textContent = 'AR 已結束';
        });

        startButton.style.display = 'none';
        placeMarkerButton.style.display = 'block';
        markerCountDiv.style.display = 'block';
        updateMarkerCount();

        // 檢查是否有已儲存的錨點
        const stored = localStorage.getItem('persistentAnchors');
        if (stored) {
            const anchorData = JSON.parse(stored);
            savedAnchorUUIDs = anchorData;
            updateMarkerCount();
        }

        info.textContent = '移動到想要的位置後,點擊「放置訊號點」';

        log('Starting animation loop...');
        renderer.setAnimationLoop(render);
        log('AR started successfully!');
    } catch (err) {
        info.textContent = 'AR 啟動失敗: ' + err.message;
        log('ERROR: ' + err.message);
        log('Stack: ' + err.stack);
        
        // 如果是因為不支援 anchors
        if (err.message.includes('anchors')) {
            info.textContent = '❌ 您的裝置不支援 WebXR Anchors';
            anchorStatus.textContent = '此裝置不支援錨點功能';
            anchorStatus.style.display = 'block';
        }
    }
}

// 每一幀的渲染：更新相機與錨點姿態後繪製場景
function render(timestamp, frame) {
    if (frame && refSpace) {
        const pose = frame.getViewerPose(refSpace);
        if (pose) {
            // 更新相機位置
            const view = pose.views[0];
            camera.matrix.fromArray(view.transform.matrix);
            camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
        }

        // 如果有待建立的標記，在此 XRFrame 中執行
        if (pendingMarkerCreation) {
            createAnchorInFrame(frame);
        }

        // 更新所有錨點對應的標記位置
        updateAnchorPoses(frame);
    }
    renderer.render(scene, camera);
}

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
            info.textContent = '✅ 您的裝置支援 AR,點擊開始';
            startButton.style.display = 'block';
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

// 事件監聽
startButton.addEventListener('click', startAR);
placeMarkerButton.addEventListener('click', placeMarker);
saveButton.addEventListener('click', saveAllMarkers);
clearButton.addEventListener('click', clearAllMarkers);

// 初始化
init();
checkWebXRSupport();
