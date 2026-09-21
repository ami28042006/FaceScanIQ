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

// --- STATE MANAGEMENT ---
let qrExpirationTimer = null;
let activeSessionActive = false;
let currentMode = 'signup';
let currentRole = 'Faculty';

let html5QrCode = null;
let faceVideoStream = null;
let activeFacultySessionId = null;
let isScanningActive = false;

// Track active authenticated user in session
let currentUser = {
    name: "Alex Johnson",
    identifier: "CS2026-042",
    role: "Faculty"
};

// --- REAL-TIME ATTENDANCE SYNC (FIREBASE & CROSS-TAB) ---
function initFacultyRealtimeListener() {
    if (!db) return;
    
    // Listen across all sessions in the database
    db.ref('attendance').off(); // Detach previous listeners if re-authenticating
    db.ref('attendance').on('child_added', (sessionSnapshot) => {
        // Listen to individual student records inside each session
        sessionSnapshot.ref.on('child_added', (recordSnapshot) => {
            const student = recordSnapshot.val();
            if (student && student.name) {
                appendAttendanceToFacultyTable(student.name, student.rollNumber, student.timestamp);
            }
        });
    });
}

// Listen for attendance logged across tabs/windows (Local Fallback)
window.addEventListener('storage', (event) => {
    if (event.key === 'latest_attendance_entry' && event.newValue) {
        try {
            const entry = JSON.parse(event.newValue);
            appendAttendanceToFacultyTable(entry.name, entry.rollNumber, entry.timestamp);
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
        btnSignUp.classList.add('active');
        btnSignIn.classList.remove('active');
        nameGroup.style.display = 'block';
        document.getElementById('nameInput').setAttribute('required', 'true');
        submitBtn.textContent = 'Create Account →';
    } else {
        btnSignIn.classList.add('active');
        btnSignUp.classList.remove('active');
        nameGroup.style.display = 'none';
        document.getElementById('nameInput').removeAttribute('required');
        submitBtn.textContent = 'Sign In →';
    }
}

function setRole(role, element) {
    currentRole = role;
    document.querySelectorAll('.roles .role').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');

    const userLabel = document.getElementById('userLabel');
    const userInput = document.getElementById('userInput');

    if (role === 'Faculty') {
        userLabel.textContent = 'Faculty Identification / Email';
        userInput.placeholder = 'Enter faculty email';
    } else if (role === 'Student') {
        userLabel.textContent = 'Student Roll Number / Email';
        userInput.placeholder = 'Enter student roll number or email';
    } else if (role === 'Parents') {
        userLabel.textContent = 'Parent Email / Registered Phone';
        userInput.placeholder = 'Enter parent contact info';
    }
}

function handleAuthSubmit(event) {
    event.preventDefault();

    const enteredIdentifier = document.getElementById('userInput').value.trim();
    const enteredName = document.getElementById('nameInput') ? document.getElementById('nameInput').value.trim() : '';

    if (currentMode === 'signup') {
        const profile = {
            name: enteredName || "Student User",
            identifier: enteredIdentifier,
            role: currentRole
        };
        localStorage.setItem(`user_${enteredIdentifier}`, JSON.stringify(profile));
        alert('Account successfully created! Please sign in with your credentials.');
        setAuthMode('signin');
        document.getElementById('passwordInput').value = '';
        return;
    }

    // SIGN IN LOGIC: Resolve actual profile details
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

    // Display greeting in Navbar
    const greetingBadge = document.getElementById('navUserGreeting');
    if (greetingBadge) {
        greetingBadge.textContent = `${currentUser.name} (${currentRole})`;
        greetingBadge.style.display = 'inline-block';
    }

    // Update profile card in Student dashboard if elements exist
    const profileNameInput = document.getElementById('profileName');
    const profileEmailInput = document.getElementById('profileEmail');
    if (profileNameInput) profileNameInput.value = currentUser.name;
    if (profileEmailInput) profileEmailInput.value = currentUser.identifier;

    // Transition to Dashboard
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';

    const bgOverlay = document.querySelector('.bg-overlay');
    if (bgOverlay) bgOverlay.classList.add('dashboard-bg');

    document.getElementById('faculty-panel').style.display = 'none';
    document.getElementById('student-panel').style.display = 'none';
    document.getElementById('parent-panel').style.display = 'none';

    if (currentRole === 'Faculty') {
        document.getElementById('faculty-panel').style.display = 'block';
        initFacultyRealtimeListener(); // Start listening for live attendance immediately
    } else if (currentRole === 'Student') {
        document.getElementById('student-panel').style.display = 'block';
        
        const qrStepCard = document.getElementById('qr-step-card');
        const faceStepCard = document.getElementById('face-step-card');
        if (qrStepCard) qrStepCard.style.display = 'block';
        if (faceStepCard) faceStepCard.style.display = 'none';

        setTimeout(initStudentScanner, 300);
    } else if (currentRole === 'Parents') {
        document.getElementById('parent-panel').style.display = 'block';
    }
}

function logout() {
    stopAllCameras();

    const bgOverlay = document.querySelector('.bg-overlay');
    if (bgOverlay) bgOverlay.classList.remove('dashboard-bg');

    document.getElementById('dashboard-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    
    document.getElementById('userInput').value = '';
    document.getElementById('passwordInput').value = '';
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
    qrcodeContainer.innerHTML = '';
    const subject = document.getElementById('subjectSelect').value;
    const program = document.getElementById('programTypeSelect').value;
    const year = document.getElementById('academicYearSelect').value;
    const validitySeconds = parseInt(document.getElementById('timeLimitSelect').value, 10);

    // Unique session token for live cross-device sync
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
            width: 160,
            height: 160
        });
    }

    activeSessionActive = true;
    localStorage.setItem('activeQR_session', sessionToken);
    localStorage.setItem('activeQR_status', 'open');

    let timeLeft = validitySeconds;
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.style.display = 'block';

    if (qrExpirationTimer) clearInterval(qrExpirationTimer);

    qrExpirationTimer = setInterval(() => {
        let mins = Math.floor(timeLeft / 60);
        let secs = timeLeft % 60;
        timerDisplay.textContent = `Expires in: ${mins}:${secs < 10 ? '0' : ''}${secs}`;

        if (timeLeft <= 0) {
            clearInterval(qrExpirationTimer);
            activeSessionActive = false;
            localStorage.setItem('activeQR_status', 'expired');
            qrcodeContainer.innerHTML = '<p style="color: #ef4444; font-size: 13px; font-weight: 600; padding: 16px;">QR Code Expired.</p>';
            timerDisplay.textContent = 'Session Closed';
        }
        timeLeft--;
    }, 1000);
}

// --- OPTIMIZED FAST SCANNER & RE-APPEARANCE LOGIC ---
function initStudentScanner() {
    const qrRegion = document.getElementById('qr-reader');
    if (!qrRegion || typeof Html5Qrcode === 'undefined') return;

    if (html5QrCode) {
        html5QrCode.stop().catch(() => {}).then(startFastCamera);
    } else {
        startFastCamera();
    }
}

function startFastCamera() {
    if (isScanningActive) return;

    const qrRegion = document.getElementById('qr-reader');
    qrRegion.innerHTML = '';

    html5QrCode = new Html5Qrcode("qr-reader");

    // Dynamic responsive scanning square for fast focus
    const calculateScanBox = function(viewfinderWidth, viewfinderHeight) {
        const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75);
        return { width: edge, height: edge };
    };

    const config = { 
        fps: 25, // Higher frame rate for lightning-quick capture
        qrbox: calculateScanBox,
        aspectRatio: 1.0,
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    };

    isScanningActive = true;

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        onQrScanSuccess,
        () => {} // Quiet drop frames to optimize CPU
    ).catch(() => {
        // Fallback to front camera if rear environment lens fails
        html5QrCode.start(
            { facingMode: "user" },
            config,
            onQrScanSuccess,
            () => {}
        ).catch(err => {
            console.error("Camera access failed", err);
            isScanningActive = false;
            alert("Camera access denied or unavailable. Please verify permissions.");
        });
    });
}

// Anti-Screenshot & Expiry Check on Scan
function onQrScanSuccess(decodedText) {
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

    if (!isValid) {
        alert("⚠️ Invalid or unrecognized QR code. Please scan the live classroom screen.");
        return;
    }

    if (qrData && qrData.sessionId) {
        sessionStorage.setItem('active_scanned_session_id', qrData.sessionId);
    }

    isScanningActive = false;

    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            proceedToFaceScan(qrData ? qrData.subject : "Lecture");
        }).catch(() => proceedToFaceScan("Lecture"));
    } else {
        proceedToFaceScan("Lecture");
    }
}

function proceedToFaceScan(subjectName) {
    document.getElementById('qr-step-card').style.display = 'none';
    document.getElementById('face-step-card').style.display = 'block';

    sessionStorage.setItem('current_attendance_subject', subjectName);
    startFaceCamera();
}

function startFaceCamera() {
    const faceVideo = document.getElementById('faceVideo');
    if (!faceVideo) {
        simulateFaceMatch();
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
        .then(stream => {
            faceVideoStream = stream;
            faceVideo.srcObject = stream;
            faceVideo.play();

            // Biometric verification window (2.5 seconds)
            setTimeout(() => {
                stopAllCameras();
                simulateFaceMatch();
            }, 2500);
        })
        .catch(() => {
            simulateFaceMatch();
        });
}

function simulateFaceMatch() {
    const sessionData = sessionStorage.getItem('active_session_user');
    let studentName = currentUser.name;
    let rollNumber = currentUser.identifier;

    if (sessionData) {
        const parsed = JSON.parse(sessionData);
        studentName = parsed.name || studentName;
        rollNumber = parsed.identifier || rollNumber;
    }

    recordStudentAttendance(studentName, rollNumber);
}

function stopAllCameras() {
    if (html5QrCode) {
        try { 
            html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {}); 
        } catch (e) {}
        isScanningActive = false;
    }
    if (faceVideoStream) {
        faceVideoStream.getTracks().forEach(track => track.stop());
        faceVideoStream = null;
    }
}

// Resets back to the active QR scanner so the student can scan repeatedly
function resetToScanner() {
    stopAllCameras();
    const faceStepCard = document.getElementById('face-step-card');
    const qrStepCard = document.getElementById('qr-step-card');
    
    if (faceStepCard) faceStepCard.style.display = 'none';
    if (qrStepCard) qrStepCard.style.display = 'block';
    
    setTimeout(() => {
        initStudentScanner();
    }, 250);
}

// Append dynamically to Faculty overview table (Prevents Duplicates)
function appendAttendanceToFacultyTable(name, roll, time) {
    const tbody = document.getElementById('liveAttendanceTableBody');
    if (!tbody) return;

    // Check if student is already in the table
    const existingRows = tbody.querySelectorAll('tr');
    for (let row of existingRows) {
        if (row.dataset.roll === roll) {
            return; // Avoid duplicating verified records
        }
    }

    // Remove empty notice if present
    const emptyNotice = document.getElementById('emptyFacultyNotice');
    if (emptyNotice) emptyNotice.remove();

    const newRow = document.createElement('tr');
    newRow.dataset.roll = roll;
    newRow.innerHTML = `
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

function recordStudentAttendance(studentName, rollNumber) {
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
        status: "Verified",
        syncId: Date.now()
    };

    // 1. Push to Firebase Realtime Database (Cloud Sync to Faculty Screen)
    if (db) {
        db.ref('attendance/' + activeSessionId).push(attendanceRecord)
            .then(() => {
                alert(`✅ Attendance marked & synced for ${attendanceRecord.name}!`);
                resetToScanner(); // Re-open scanner automatically
            })
            .catch((err) => {
                console.error("Firebase push error:", err);
                alert(`⚠️ Attendance recorded locally, but cloud sync encountered an error.`);
                resetToScanner();
            });
    } else {
        alert(`✅ Attendance recorded for ${attendanceRecord.name}!`);
        resetToScanner();
    }

    // 2. Same-Device/Local Broadcast
    appendAttendanceToFacultyTable(attendanceRecord.name, attendanceRecord.rollNumber, attendanceRecord.timestamp);
    localStorage.setItem('latest_attendance_entry', JSON.stringify(attendanceRecord));

    // 3. Update Student's Personal Log Table
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
    simulateFaceMatch();
}

function handleStudentProfileUpdate(event) {
    event.preventDefault();
    const updatedName = document.getElementById('profileName').value;
    currentUser.name = updatedName;
    sessionStorage.setItem('active_session_user', JSON.stringify(currentUser));
    alert(`Profile details updated for ${updatedName}!`);
}

function handleLeaveSubmit(event) {
    event.preventDefault();
    const fromDate = document.getElementById('leaveFromDate').value;
    const toDate = document.getElementById('leaveToDate').value;
    const reason = document.getElementById('leaveReason').value;

    const tbody = document.getElementById('leaveHistoryTable');
    if (tbody) {
        const newRow = document.createElement('tr');
        newRow.innerHTML = `
            <td>${fromDate} - ${toDate}</td>
            <td>${reason}</td>
            <td><span class="status-badge" style="background: rgba(251, 191, 36, 0.15); color: #fbbf24;">Pending Review</span></td>
        `;
        tbody.prepend(newRow);
    }
    alert('Leave application submitted!');
    event.target.reset();
}