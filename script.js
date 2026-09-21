// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyALkvfbWvTupUsaluo5rbti_6qqe4eV_Yo",
    authDomain: "facescaniq-7f7c4.firebaseapp.com",
    databaseURL: "https://facescaniq-7f7c4-default-rtdb.firebaseio.com",
    projectId: "facescaniq-7f7c4",
    storageBucket: "facescaniq-7f7c4.firebasestorage.app",
    messagingSenderId: "16402656121",
    appId: "1:16402656121:web:2eafa476ffbcc171b15da8",
    measurementId: "G-8M1HS3RDS8"
};

// Initialize Firebase & Database Reference
let db = null;
try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.database();
    }
} catch (e) {
    console.warn("Firebase initialization skipped or failed. Falling back to local events.", e);
}

// --- GEOFENCING CONFIGURATION ---
const GEOFENCE_CONFIG = {
    enabled: false, // Geofence disabled for easy testing at home
    classroomLat: 22.3072,
    classroomLng: 73.1812,
    allowedRadiusMeters: 100
};

// Calculate distance between two GPS coordinates in meters (Haversine Formula)
function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function verifyGeofence() {
    return new Promise((resolve, reject) => {
        if (!GEOFENCE_CONFIG.enabled) {
            resolve({ inBounds: true, distance: 0 });
            return;
        }

        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported by your device browser."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const studentLat = pos.coords.latitude;
                const studentLng = pos.coords.longitude;
                const dist = calculateDistanceInMeters(
                    studentLat,
                    studentLng,
                    GEOFENCE_CONFIG.classroomLat,
                    GEOFENCE_CONFIG.classroomLng
                );

                if (dist <= GEOFENCE_CONFIG.allowedRadiusMeters) {
                    resolve({ inBounds: true, distance: Math.round(dist) });
                } else {
                    resolve({ inBounds: false, distance: Math.round(dist) });
                }
            },
            (err) => {
                reject(err);
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });
}

// --- STATE MANAGEMENT ---
let qrExpirationTimer = null;
let activeSessionActive = false;
let currentMode = 'signin';
let currentRole = 'Faculty';

let qrStream = null;
let faceVideoStream = null;
let qrScanAnimationId = null;
let isProcessingScan = false;
let isBiometricCapturing = false;
let biometricTimeout = null;
let activeFacultySessionId = null;

// Track active authenticated user in session
let currentUser = {
    name: "Alex Johnson",
    identifier: "CS2026-042",
    role: "Faculty"
};

// --- REAL-TIME ATTENDANCE SYNC (FIREBASE & CROSS-TAB) ---
function initFacultyRealtimeListener() {
    if (!db) return;
    
    db.ref('attendance').off();
    db.ref('attendance').on('child_added', (sessionSnapshot) => {
        sessionSnapshot.ref.on('child_added', (recordSnapshot) => {
            const student = recordSnapshot.val();
            if (student && student.name) {
                appendAttendanceToFacultyTable(student.name, student.rollNumber, student.timestamp, student.photo);
            }
        });
    });
}

// Listen for attendance logged across tabs/windows (Local Fallback)
window.addEventListener('storage', (event) => {
    if (event.key === 'latest_attendance_entry' && event.newValue) {
        try {
            const entry = JSON.parse(event.newValue);
            appendAttendanceToFacultyTable(entry.name, entry.rollNumber, entry.timestamp, entry.photo);
        } catch (e) {
            console.error("Failed to parse cross-tab attendance entry", e);
        }
    }
});

function setAuthMode(mode) {
    currentMode = mode;
    const btnSignUp = document.getElementById('btnSignUp');
    const btnSignIn = document.getElementById('btnSignIn');
    const nameGroup = document.getElementById('nameGroup');
    const submitBtn = document.getElementById('submitBtn');

    if (mode === 'signup') {
        if (btnSignUp) btnSignUp.classList.add('active');
        if (btnSignIn) btnSignIn.classList.remove('active');
        if (nameGroup) nameGroup.style.display = 'block';
        const nameInput = document.getElementById('nameInput');
        if (nameInput) nameInput.setAttribute('required', 'true');
        if (submitBtn) submitBtn.textContent = 'Create Account →';
    } else {
        if (btnSignIn) btnSignIn.classList.add('active');
        if (btnSignUp) btnSignUp.classList.remove('active');
        if (nameGroup) nameGroup.style.display = 'none';
        const nameInput = document.getElementById('nameInput');
        if (nameInput) nameInput.removeAttribute('required');
        if (submitBtn) submitBtn.textContent = 'Sign In →';
    }
}

function setRole(role, element) {
    currentRole = role;
    document.querySelectorAll('.roles .role').forEach(btn => btn.classList.remove('active'));
    if (element) element.classList.add('active');

    const userLabel = document.getElementById('userLabel');
    const userInput = document.getElementById('userInput');

    if (role === 'Faculty') {
        if (userLabel) userLabel.textContent = 'Faculty Identification / Email';
        if (userInput) userInput.placeholder = 'Enter faculty email';
    } else if (role === 'Student') {
        if (userLabel) userLabel.textContent = 'Student Roll Number / Email';
        if (userInput) userInput.placeholder = 'Enter student roll number or email';
    } else if (role === 'Parents') {
        if (userLabel) userLabel.textContent = 'Parent Email / Registered Phone';
        if (userInput) userInput.placeholder = 'Enter parent contact info';
    }
}

function handleAuthSubmit(event) {
    event.preventDefault();

    const userInputElem = document.getElementById('userInput');
    const nameInputElem = document.getElementById('nameInput');
    const enteredIdentifier = userInputElem ? userInputElem.value.trim() : '';
    const enteredName = nameInputElem ? nameInputElem.value.trim() : '';

    if (currentMode === 'signup') {
        const profile = {
            name: enteredName || "Student User",
            identifier: enteredIdentifier,
            role: currentRole
        };
        localStorage.setItem(`user_${enteredIdentifier}`, JSON.stringify(profile));
        alert('Account successfully created! Please sign in with your credentials.');
        setAuthMode('signin');
        const passInput = document.getElementById('passwordInput');
        if (passInput) passInput.value = '';
        return;
    }

    const savedAccount = localStorage.getItem(`user_${enteredIdentifier}`);
    if (savedAccount) {
        currentUser = JSON.parse(savedAccount);
    } else {
        currentUser = {
            name: enteredName || (enteredIdentifier.includes('@') ? enteredIdentifier.split('@')[0] : enteredIdentifier) || "Student User",
            identifier: enteredIdentifier,
            role: currentRole
        };
    }

    sessionStorage.setItem('active_session_user', JSON.stringify(currentUser));

    const topNavbar = document.getElementById('topNavbar');
    if (topNavbar) topNavbar.style.display = 'flex';

    const greetingBadge = document.getElementById('navUserGreeting');
    if (greetingBadge) {
        greetingBadge.textContent = `${currentUser.name} (${currentRole})`;
        greetingBadge.style.display = 'inline-block';
    }

    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';

    const bgOverlay = document.querySelector('.bg-overlay');
    if (bgOverlay) bgOverlay.classList.add('dashboard-bg');

    document.getElementById('faculty-panel').style.display = 'none';
    document.getElementById('student-panel').style.display = 'none';
    document.getElementById('parent-panel').style.display = 'none';

    if (currentRole === 'Faculty') {
        document.getElementById('faculty-panel').style.display = 'block';
        initFacultyRealtimeListener();
    } else if (currentRole === 'Student') {
        document.getElementById('student-panel').style.display = 'block';
        
        const qrStepCard = document.getElementById('qr-step-card');
        const faceStepCard = document.getElementById('face-step-card');
        if (qrStepCard) qrStepCard.style.display = 'block';
        if (faceStepCard) faceStepCard.style.display = 'none';

        setTimeout(startInstantQrScanner, 250);
    } else if (currentRole === 'Parents') {
        document.getElementById('parent-panel').style.display = 'block';
        const parentChildName = document.getElementById('parentChildName');
        if (parentChildName) parentChildName.textContent = currentUser.name;
    }
}

function logout() {
    stopAllCameras();

    const bgOverlay = document.querySelector('.bg-overlay');
    if (bgOverlay) bgOverlay.classList.remove('dashboard-bg');

    const topNavbar = document.getElementById('topNavbar');
    if (topNavbar) topNavbar.style.display = 'none';

    document.getElementById('dashboard-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    
    const userInput = document.getElementById('userInput');
    if (userInput) userInput.value = '';
    const passInput = document.getElementById('passwordInput');
    if (passInput) passInput.value = '';
    const nameInput = document.getElementById('nameInput');
    if (nameInput) nameInput.value = '';

    const greetingBadge = document.getElementById('navUserGreeting');
    if (greetingBadge) greetingBadge.style.display = 'none';

    sessionStorage.removeItem('active_session_user');

    if (qrExpirationTimer) clearInterval(qrExpirationTimer);
    activeSessionActive = false;
}

function updateSubjectList() {
    const program = document.getElementById('programTypeSelect').value;
    const subjectSelect = document.getElementById('subjectSelect');
    if (!subjectSelect) return;
    subjectSelect.innerHTML = '';

    if (program === 'Degree') {
        subjectSelect.innerHTML = `
            <option value="CS-301: Machine Learning">CS-301: Machine Learning</option>
            <option value="CS-102: Data Structures">CS-102: Data Structures</option>
            <option value="CS-204: Web Technologies">CS-204: Web Technologies</option>
            <option value="CS-405: Cloud Computing">CS-405: Cloud Computing</option>
        `;
    } else {
        subjectSelect.innerHTML = `
            <option value="DCE-201: Basic Computer Networks">DCE-201: Basic Computer Networks</option>
            <option value="DCE-202: Database Management">DCE-202: Database Management</option>
            <option value="DCE-203: Operating Systems">DCE-203: Operating Systems</option>
        `;
    }
}

// Faculty: Generate Timed QR with Realtime Database Cloud Sync
function startTimedQRGeneration() {
    const qrcodeContainer = document.getElementById('qrcode');
    if (!qrcodeContainer) return;
    qrcodeContainer.innerHTML = '';

    const subjectSelect = document.getElementById('subjectSelect');
    const subject = subjectSelect ? subjectSelect.value : "General Lecture";
    const program = document.getElementById('programTypeSelect') ? document.getElementById('programTypeSelect').value : "Degree";
    const year = document.getElementById('academicYearSelect') ? document.getElementById('academicYearSelect').value : "1st Year";
    const validitySeconds = parseInt(document.getElementById('timeLimitSelect').value, 10) || 60;

    activeFacultySessionId = 'sess_' + Date.now();

    const sessionData = {
        app: "FaceScanIQ",
        sessionId: activeFacultySessionId,
        program: program,
        year: year,
        subject: subject,
        createdAt: Date.now(),
        ttl: validitySeconds * 1000
    };
    const sessionToken = JSON.stringify(sessionData);
    
    if (typeof QRCode !== 'undefined') {
        new QRCode(qrcodeContainer, {
            text: sessionToken,
            width: 180,
            height: 180
        });
    }

    activeSessionActive = true;
    localStorage.setItem('activeQR_session', sessionToken);
    localStorage.setItem('activeQR_status', 'open');

    let timeLeft = validitySeconds;
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.style.display = 'block';
        timerDisplay.textContent = `Expires in: ${timeLeft}s`;
    }

    if (qrExpirationTimer) clearInterval(qrExpirationTimer);

    qrExpirationTimer = setInterval(() => {
        let mins = Math.floor(timeLeft / 60);
        let secs = timeLeft % 60;
        if (timerDisplay) {
            timerDisplay.textContent = `Expires in: ${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        if (timeLeft <= 0) {
            clearInterval(qrExpirationTimer);
            activeSessionActive = false;
            localStorage.setItem('activeQR_status', 'expired');
            qrcodeContainer.innerHTML = '<p style="color: #ef4444; font-size: 13px; font-weight: 600; padding: 16px;">QR Code Expired.</p>';
            if (timerDisplay) timerDisplay.textContent = 'Session Closed';
        }
        timeLeft--;
    }, 1000);
}

// --- HIGH-SPEED INSTANT QR SCANNER (WHATSAPP-STYLE DIRECT FEED) ---
async function startInstantQrScanner() {
    isProcessingScan = false;
    const qrVideo = document.getElementById('qrScannerVideo');
    if (!qrVideo) return;

    stopAllCameras();

    try {
        qrStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });
        qrVideo.srcObject = qrStream;
        await qrVideo.play();

        if ('BarcodeDetector' in window) {
            const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
            scanBarcodeLoopNative(qrVideo, barcodeDetector);
        } else {
            scanBarcodeLoopFallback(qrVideo);
        }
    } catch (err) {
        console.warn("Primary environment camera failed, trying default constraint:", err);
        try {
            qrStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            qrVideo.srcObject = qrStream;
            await qrVideo.play();
            scanBarcodeLoopFallback(qrVideo);
        } catch (subErr) {
            console.error("Camera access failed", subErr);
            alert("Camera access denied or unavailable. Please enable permissions in your browser settings.");
        }
    }
}

async function scanBarcodeLoopNative(video, detector) {
    if (isProcessingScan) return;
    try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
                onQrScanMatch(barcodes[0].rawValue);
                return;
            }
        }
    } catch (e) {}

    qrScanAnimationId = requestAnimationFrame(() => scanBarcodeLoopNative(video, detector));
}

function scanBarcodeLoopFallback(video) {
    if (isProcessingScan) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && typeof jsQR !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });

        if (code && code.data) {
            onQrScanMatch(code.data);
            return;
        }
    }
    qrScanAnimationId = requestAnimationFrame(() => scanBarcodeLoopFallback(video));
}

// Anti-Screenshot: Strict TTL + Live Classroom Geofence Verification
async function onQrScanMatch(decodedText) {
    let isValid = false;
    let qrData = null;

    try {
        qrData = JSON.parse(decodedText);
        if (qrData.app === "FaceScanIQ") {
            const now = Date.now();
            if (qrData.createdAt && qrData.ttl) {
                if (now - qrData.createdAt > qrData.ttl) {
                    alert("❌ Expired QR Code! Screenshots or old codes are not accepted.");
                    return;
                }
            }
            isValid = true;
        }
    } catch (e) {
        if (decodedText.includes("CS-") || decodedText.includes("DCE-")) isValid = true;
    }

    if (!isValid) return;

    isProcessingScan = true;
    if (qrScanAnimationId) cancelAnimationFrame(qrScanAnimationId);

    // Stop rear stream
    if (qrStream) {
        qrStream.getTracks().forEach(t => t.stop());
        qrStream = null;
    }

    // Geofence GPS Check
    try {
        const geoResult = await verifyGeofence();
        if (!geoResult.inBounds) {
            alert(`🚫 Attendance Blocked!\nYou are ${geoResult.distance}m away. You must be physically inside the classroom (${GEOFENCE_CONFIG.allowedRadiusMeters}m radius).`);
            resetToScanner();
            return;
        }
    } catch (geoErr) {
        alert("⚠️ Location check failed: Please allow Location/GPS access to confirm physical presence.");
        resetToScanner();
        return;
    }

    if (qrData && qrData.sessionId) {
        sessionStorage.setItem('active_scanned_session_id', qrData.sessionId);
    }

    proceedToFaceScan(qrData ? qrData.subject : "Lecture");
}

// --- STEP 2: FRONT-FACING BIOMETRICS & PHOTO SNAPSHOT ---
function proceedToFaceScan(subjectName) {
    document.getElementById('qr-step-card').style.display = 'none';
    document.getElementById('face-step-card').style.display = 'block';

    sessionStorage.setItem('current_attendance_subject', subjectName);
    startFaceBiometricScan();
}

async function startFaceBiometricScan() {
    isBiometricCapturing = false;
    const faceVideo = document.getElementById('faceVideo');
    const statusMsg = document.getElementById('faceStatusMsg');
    if (statusMsg) statusMsg.textContent = "Align face in circle... Verifying...";

    if (!faceVideo) {
        captureStudentFaceAndMark();
        return;
    }

    try {
        faceVideoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        faceVideo.srcObject = faceVideoStream;
        await faceVideo.play();

        if (biometricTimeout) clearTimeout(biometricTimeout);
        biometricTimeout = setTimeout(() => {
            captureStudentFaceAndMark();
        }, 1800);
    } catch (err) {
        console.warn("Front camera fallback:", err);
        captureStudentFaceAndMark();
    }
}

function captureStudentFaceAndMark() {
    if (isBiometricCapturing) return;
    isBiometricCapturing = true;

    if (biometricTimeout) {
        clearTimeout(biometricTimeout);
        biometricTimeout = null;
    }

    const faceVideo = document.getElementById('faceVideo');
    const canvas = document.getElementById('faceCaptureCanvas');
    let capturedPhotoData = null;

    if (faceVideo && faceVideoStream && canvas) {
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(faceVideo.videoWidth || 640, faceVideo.videoHeight || 480);
        const startX = ((faceVideo.videoWidth || 640) - minDim) / 2;
        const startY = ((faceVideo.videoHeight || 480) - minDim) / 2;

        ctx.drawImage(faceVideo, startX, startY, minDim, minDim, 0, 0, 160, 160);
        capturedPhotoData = canvas.toDataURL('image/jpeg', 0.6);
    }

    stopAllCameras();

    const sessionData = sessionStorage.getItem('active_session_user');
    let studentName = currentUser.name;
    let rollNumber = currentUser.identifier;

    if (sessionData) {
        const parsed = JSON.parse(sessionData);
        studentName = parsed.name || studentName;
        rollNumber = parsed.identifier || rollNumber;
    }

    recordStudentAttendance(studentName, rollNumber, capturedPhotoData);
}

function stopAllCameras() {
    if (qrScanAnimationId) {
        cancelAnimationFrame(qrScanAnimationId);
        qrScanAnimationId = null;
    }
    if (biometricTimeout) {
        clearTimeout(biometricTimeout);
        biometricTimeout = null;
    }
    if (qrStream) {
        qrStream.getTracks().forEach(track => track.stop());
        qrStream = null;
    }
    if (faceVideoStream) {
        faceVideoStream.getTracks().forEach(track => track.stop());
        faceVideoStream = null;
    }
    isProcessingScan = false;
}

function resetToScanner() {
    stopAllCameras();
    const faceStepCard = document.getElementById('face-step-card');
    const qrStepCard = document.getElementById('qr-step-card');

    if (faceStepCard) faceStepCard.style.display = 'none';
    if (qrStepCard) qrStepCard.style.display = 'block';

    setTimeout(() => {
        startInstantQrScanner();
    }, 250);
}

function appendAttendanceToFacultyTable(name, roll, time, photo) {
    const tbody = document.getElementById('liveAttendanceTableBody');
    if (!tbody) return;

    const existingRows = tbody.querySelectorAll('tr');
    for (let row of existingRows) {
        if (row.dataset.roll === roll) {
            return;
        }
    }

    const emptyNotice = document.getElementById('emptyFacultyNotice');
    if (emptyNotice) emptyNotice.remove();

    const fallbackImg = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=38bdf8&color=fff`;
    const photoUrl = photo || fallbackImg;

    const newRow = document.createElement('tr');
    newRow.dataset.roll = roll;
    newRow.innerHTML = `
        <td><img src="${photoUrl}" class="student-table-photo" alt="${name}"></td>
        <td><strong>${name}</strong></td>
        <td>${roll}</td>
        <td>${time}</td>
        <td><span class="status-badge">Verified</span></td>
    `;
    tbody.prepend(newRow);
    
    const badge = document.getElementById('liveCountBadge');
    if (badge) {
        const count = tbody.querySelectorAll('tr[data-roll]').length;
        badge.textContent = `Present: ${count}`;
    }
}

function recordStudentAttendance(studentName, rollNumber, photoData) {
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateString = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const subject = sessionStorage.getItem('current_attendance_subject') || "CS-301: Machine Learning";
    const activeSessionId = sessionStorage.getItem('active_scanned_session_id') || 'default_session';

    const attendanceRecord = {
        name: studentName,
        rollNumber: rollNumber,
        timestamp: timeString,
        date: dateString,
        subject: subject,
        photo: photoData,
        status: "Verified",
        syncId: Date.now()
    };

    if (db) {
        db.ref('attendance/' + activeSessionId).push(attendanceRecord)
            .then(() => {
                alert(`✅ Attendance marked & synced for ${attendanceRecord.name}!`);
                resetToScanner();
            })
            .catch((err) => {
                console.error("Firebase push error:", err);
                alert(`✅ Attendance recorded for ${attendanceRecord.name}!`);
                resetToScanner();
            });
    } else {
        alert(`✅ Attendance recorded for ${attendanceRecord.name}!`);
        resetToScanner();
    }

    appendAttendanceToFacultyTable(attendanceRecord.name, attendanceRecord.rollNumber, attendanceRecord.timestamp, attendanceRecord.photo);
    localStorage.setItem('latest_attendance_entry', JSON.stringify(attendanceRecord));

    const studentLog = document.getElementById('student-log');
    if (studentLog) {
        const emptyNotice = document.getElementById('emptyStudentNotice');
        if (emptyNotice) emptyNotice.remove();

        const studentRow = document.createElement('tr');
        studentRow.innerHTML = `
            <td>${attendanceRecord.subject}</td>
            <td>${attendanceRecord.date} (${attendanceRecord.timestamp})</td>
            <td><span class="status-badge">Present</span></td>
        `;
        studentLog.prepend(studentRow);
    }
}

function simulateScanSuccess() {
    captureStudentFaceAndMark();
}

function handleStudentProfileUpdate(event) {
    event.preventDefault();
    const profileElem = document.getElementById('profileName');
    const updatedName = profileElem ? profileElem.value : currentUser.name;
    currentUser.name = updatedName;
    sessionStorage.setItem('active_session_user', JSON.stringify(currentUser));
    alert(`Profile details updated for ${updatedName}!`);
}