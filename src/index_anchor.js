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

const startButton = document.getElementById('startButton');
const placeMarkerButton = document.getElementById('placeMarkerButton');
const restoreButton = document.getElementById('restoreButton');
const saveButton = document.getElementById('saveButton');
const downloadButton = document.getElementById('downloadButton');
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
    circle.position.y = 0;
    circle.position.z = -0.01;
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
    textMesh.position.z = 0.01;
    group.add(textMesh);

    return group;
}

// 放置訊號點：使用 Anchor 系統
async function placeMarker() {
    if (!session || !refSpace) {
        log('Session or refSpace not available');
        info.textContent = '請先啟動 AR 模式';
        return;
    }

    try {
        markerCount++;
        
        // 建立錨點姿態：相機位置腳下 1.6 米
        const pose = new XRRigidTransform(
            {
                x: camera.position.x,
                y: camera.position.y - 1.6,
                z: camera.position.z
            },
            { x: 0, y: 0, z: 0, w: 1 }  // 預設旋轉
        );

        // 使用 XRFrame 建立錨點
        const frame = renderer.xr.getFrame();
        if (!frame) {
            throw new Error('無法取得 XRFrame');
        }

        info.textContent = `正在建立錨點 #${markerCount}...`;
        log(`Creating anchor at (${pose.position.x.toFixed(2)}, ${pose.position.y.toFixed(2)}, ${pose.position.z.toFixed(2)})`);

        // 建立錨點（相對於 local space）
        const anchor = await frame.createAnchor(pose, refSpace);
        
        if (!anchor) {
            throw new Error('錨點建立失敗');
        }

        log(`Anchor created with UUID: ${anchor.anchorUUID || 'N/A'}`);

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
    
    if (savedAnchorUUIDs.length > 0) {
        downloadButton.style.display = 'inline-block';
        restoreButton.style.display = session ? 'inline-block' : 'none';
    } else {
        downloadButton.style.display = 'none';
        restoreButton.style.display = 'none';
    }
}

// 儲存所有錨點 UUID
function saveAllMarkers() {
    if (anchors.length === 0) {
        info.textContent = '❌ 沒有訊號點可以儲存';
        return;
    }

    // 儲存錨點 UUID（注意：UUID 可能存在於不同屬性）
    savedAnchorUUIDs = anchors.map((anchor, index) => {
        const uuid = anchor.anchorUUID || anchor.uuid || `anchor_${index}`;
        return {
            uuid: uuid,
            label: `訊號點 ${index + 1}`,
            timestamp: new Date().toISOString()
        };
    });

    // 儲存到 localStorage
    try {
        localStorage.setItem('persistentAnchors', JSON.stringify(savedAnchorUUIDs));
        info.textContent = `✅ 已儲存 ${savedAnchorUUIDs.length} 個錨點 UUID`;
        log(`Saved ${savedAnchorUUIDs.length} anchor UUIDs to localStorage`);
        updateMarkerCount();
    } catch (err) {
        info.textContent = `❌ 儲存失敗: ${err.message}`;
        log('ERROR saving to localStorage: ' + err.message);
    }
}

// 恢復已儲存的錨點
async function restoreSavedMarkers() {
    if (!session) {
        info.textContent = '❌ 請先啟動 AR 模式';
        return;
    }

    // 從 localStorage 讀取
    try {
        const stored = localStorage.getItem('persistentAnchors');
        if (!stored) {
            info.textContent = '❌ 沒有已儲存的錨點';
            return;
        }

        const anchorData = JSON.parse(stored);
        if (anchorData.length === 0) {
            info.textContent = '❌ 沒有已儲存的錨點';
            return;
        }

        info.textContent = `正在恢復 ${anchorData.length} 個錨點...`;
        log(`Attempting to restore ${anchorData.length} anchors`);

        let successCount = 0;
        let failCount = 0;

        // 檢查 session 是否支援 restorePersistentAnchor
        if (!session.restorePersistentAnchor) {
            info.textContent = '❌ 此裝置不支援持久化錨點恢復';
            log('ERROR: restorePersistentAnchor not supported');
            return;
        }

        for (let i = 0; i < anchorData.length; i++) {
            const data = anchorData[i];
            try {
                const anchor = await session.restorePersistentAnchor(data.uuid);
                
                if (anchor) {
                    const marker = createMarker(data.label || `#${i + 1}`);
                    scene.add(marker);
                    markers.push(marker);
                    anchors.push(anchor);
                    markerCount++;
                    successCount++;
                    log(`Restored anchor: ${data.uuid}`);
                } else {
                    failCount++;
                    log(`Failed to restore anchor: ${data.uuid}`);
                }
            } catch (err) {
                failCount++;
                log(`ERROR restoring anchor ${data.uuid}: ${err.message}`);
            }
        }

        updateMarkerCount();
        info.textContent = `✅ 恢復 ${successCount} 個訊號點 ${failCount > 0 ? `(${failCount} 個失敗)` : ''}`;
        
    } catch (err) {
        info.textContent = `❌ 恢復失敗: ${err.message}`;
        log('ERROR restoring anchors: ' + err.message);
    }
}

// 下載錨點資料為 JSON 檔案
function downloadMarkersAsJSON() {
    if (savedAnchorUUIDs.length === 0) {
        info.textContent = '❌ 沒有儲存的錨點';
        return;
    }

    const dataStr = JSON.stringify(savedAnchorUUIDs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anchors_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    info.textContent = `📥 已下載 ${savedAnchorUUIDs.length} 個錨點資料`;
    log(`Downloaded ${savedAnchorUUIDs.length} anchor UUIDs`);
}

// 清除所有訊號點
async function clearAllMarkers() {
    if (!confirm('確定要清除所有訊號點嗎？這也會清除已儲存的錨點。')) {
        return;
    }

    // 刪除場景中的標記
    markers.forEach(marker => scene.remove(marker));
    markers = [];
    anchors = [];
    markerCount = 0;

    // 嘗試刪除持久化錨點
    if (session && session.deletePersistentAnchor && savedAnchorUUIDs.length > 0) {
        for (const data of savedAnchorUUIDs) {
            try {
                await session.deletePersistentAnchor(data.uuid);
                log(`Deleted persistent anchor: ${data.uuid}`);
            } catch (err) {
                log(`Failed to delete anchor ${data.uuid}: ${err.message}`);
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
        if (session.persistentAnchors) {
            anchorStatus.textContent = `✅ 支援持久化錨點 (現有: ${session.persistentAnchors.length})`;
            anchorStatus.style.display = 'block';
            log(`Persistent anchors supported. Existing: ${session.persistentAnchors.length}`);
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
            restoreButton.style.display = 'none';
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
restoreButton.addEventListener('click', restoreSavedMarkers);
saveButton.addEventListener('click', saveAllMarkers);
downloadButton.addEventListener('click', downloadMarkersAsJSON);
clearButton.addEventListener('click', clearAllMarkers);

// 初始化
init();
checkWebXRSupport();
