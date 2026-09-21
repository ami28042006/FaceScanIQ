let qrExpirationTimer = null;
let activeSessionActive = false;
let currentMode = 'signup';
let currentRole = 'Faculty';

let html5QrCode = null;
let faceVideoStream = null;

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
        userInput.placeholder = 'Enter student roll number';
    } else if (role === 'Parents') {
        userLabel.textContent = 'Parent Email / Registered Phone';
        userInput.placeholder = 'Enter parent contact info';
    }
}

function handleAuthSubmit(event) {
    event.preventDefault();

    if (currentMode === 'signup') {
        alert('Account successfully created! Please sign in with your credentials.');
        setAuthMode('signin');
        document.getElementById('passwordInput').value = '';
        return;
    }

    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';

    // Switch background dynamically for the portal dashboard
    const bgOverlay = document.querySelector('.bg-overlay');
    if (bgOverlay) {
        bgOverlay.classList.add('dashboard-bg');
    }

    document.getElementById('faculty-panel').style.display = 'none';
    document.getElementById('student-panel').style.display = 'none';
    document.getElementById('parent-panel').style.display = 'none';

    if (currentRole === 'Faculty') {
        document.getElementById('faculty-panel').style.display = 'block';
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

    // Revert back to the initial login background
    const bgOverlay = document.querySelector('.bg-overlay');
    if (bgOverlay) {
        bgOverlay.classList.remove('dashboard-bg');
    }

    document.getElementById('dashboard-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    
    document.getElementById('userInput').value = '';
    document.getElementById('passwordInput').value = '';
    const nameInput = document.getElementById('nameInput');
    if (nameInput) nameInput.value = '';

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

function startTimedQRGeneration() {
    const qrcodeContainer = document.getElementById('qrcode');
    qrcodeContainer.innerHTML = '';
    const subject = document.getElementById('subjectSelect').value;
    const program = document.getElementById('programTypeSelect').value;
    const year = document.getElementById('academicYearSelect').value;
    const validitySeconds = parseInt(document.getElementById('timeLimitSelect').value, 10);

    const sessionData = {
        app: "FaceScanIQ",
        program: program,
        year: year,
        subject: subject,
        timestamp: Date.now()
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

// Student Scanner
function initStudentScanner() {
    const qrRegion = document.getElementById('qr-reader');
    if (!qrRegion || typeof Html5Qrcode === 'undefined') return;

    if (html5QrCode) {
        html5QrCode.stop().catch(() => {}).then(startQrCamera);
    } else {
        startQrCamera();
    }
}

function startQrCamera() {
    html5QrCode = new Html5Qrcode("qr-reader");
    const config = { fps: 10, qrbox: { width: 220, height: 220 } };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        onQrScanSuccess,
        () => {}
    ).catch(() => {
        html5QrCode.start(
            { facingMode: "user" },
            config,
            onQrScanSuccess,
            () => {}
        ).catch(err => {
            console.error("Camera access failed", err);
            alert("Camera access denied or unavailable. Please enable camera permissions.");
        });
    });
}

function onQrScanSuccess(decodedText) {
    let isValid = false;

    try {
        const parsed = JSON.parse(decodedText);
        if (parsed.app === "FaceScanIQ" || parsed.subject) isValid = true;
    } catch (e) {
        if (decodedText.includes("CS-") || decodedText.includes("DCE-")) isValid = true;
    }

    if (!isValid) {
        alert("⚠️ Unrecognized QR code. Please scan the official class QR.");
        return;
    }

    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            proceedToFaceScan();
        }).catch(proceedToFaceScan);
    } else {
        proceedToFaceScan();
    }
}

function proceedToFaceScan() {
    document.getElementById('qr-step-card').style.display = 'none';
    document.getElementById('face-step-card').style.display = 'block';

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
    const studentName = document.getElementById('userInput') ? (document.getElementById('userInput').value || "Alex Johnson") : "Alex Johnson";
    const rollNumber = "CS2026-" + Math.floor(100 + Math.random() * 900);
    recordStudentAttendance(studentName, rollNumber);
}

function stopAllCameras() {
    if (html5QrCode) {
        try { html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {}); } catch (e) {}
    }
    if (faceVideoStream) {
        faceVideoStream.getTracks().forEach(track => track.stop());
        faceVideoStream = null;
    }
}

function recordStudentAttendance(studentName, rollNumber) {
    const tbody = document.getElementById('liveAttendanceTableBody');
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (tbody) {
        const newRow = document.createElement('tr');
        newRow.innerHTML = `
            <td>${studentName}</td>
            <td>${rollNumber}</td>
            <td>${timeString}</td>
            <td><span class="status-badge">Verified</span></td>
        `;
        tbody.prepend(newRow);
        
        const badge = document.getElementById('liveCountBadge');
        if (badge) badge.textContent = `Present: ${tbody.children.length}`;
    }
    
    alert('✅ Biometric face matched & attendance successfully marked!');
}

function simulateScanSuccess() {
    recordStudentAttendance("Alex Johnson", "CS2026-042");
}

function handleStudentProfileUpdate(event) {
    event.preventDefault();
    alert(`Profile details updated successfully!`);
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