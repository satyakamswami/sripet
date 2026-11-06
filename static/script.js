// Production-Ready Frontend Logic built by Satyakam Swami - Monochromatic Edition

let myId = localStorage.getItem('chat_uuid') || crypto.randomUUID();
localStorage.setItem('chat_uuid', myId);

const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
let ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/${myId}`);

let peerConnection = null;
let localStream = null;
let currentPartnerId = null;
let isMuted = false;
let signalingQueue = []; 

let callTimerInterval = null;
let secondsRemaining = 600;

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const statusText = document.getElementById("status-text");
const timerDisplay = document.getElementById("timer-display");
const timerText = document.getElementById("timer-text");
const remoteAudio = document.getElementById("remote-audio");
const btnNew = document.getElementById("btn-new");
const btnReconnect = document.getElementById("btn-reconnect");
const callControls = document.getElementById("call-controls");
const mainControls = document.getElementById("main-controls");
const btnMute = document.getElementById("btn-mute");
const btnDisconnect = document.getElementById("btn-disconnect");
const pulseRing = document.getElementById("pulse-ring");

function updateUI(status, showCallControls, animatePulse) {
    statusText.innerText = status;
    callControls.style.display = showCallControls ? "flex" : "none";
    mainControls.style.display = showCallControls ? "none" : "flex";
    
    if (animatePulse) {
        pulseRing.classList.add("active");
    } else {
        pulseRing.classList.remove("active");
    }

    if (!showCallControls) {
        stopCallTimer();
    }
}

function startCallTimer() {
    stopCallTimer();
    secondsRemaining = 600;
    timerDisplay.style.display = "inline-block";
    updateTimerText();

    callTimerInterval = setInterval(() => {
        secondsRemaining--;
        updateTimerText();

        if (secondsRemaining <= 0) {
            stopCallTimer();
            endCallLocally("10-minute limit reached");
        }
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    timerDisplay.style.display = "none";
}

function updateTimerText() {
    const mins = Math.floor(secondsRemaining / 60);
    const secs = secondsRemaining % 60;
    timerText.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function ensureMicrophoneAccess() {
    if (localStream) return true; 

    try {
        updateUI("Requesting mic...", false, false);
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return true;
    } catch (error) {
        console.error("Microphone Access Error:", error);
        alert("Microphone access is required.");
        updateUI("Disconnected", false, false);
        return false;
    }
}

ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch(data.type) {
        case "waiting":
            updateUI("Searching for partner...", false, true);
            break;
        case "waiting_reconnect":
            updateUI("Awaiting previous partner...", false, true);
            break;
        case "error":
            alert(data.message);
            updateUI("Ready to connect", false, false);
            break;
        case "matched":
            updateUI("Connected", true, true);
            currentPartnerId = data.partner_id;
            startCallTimer();
            await startCall(data.initiator);
            break;
        case "offer":
        case "answer":
        case "ice_candidate":
            if (!peerConnection) {
                signalingQueue.push(data);
            } else {
                await processSignalingMessage(data);
            }
            break;
        case "partner_left":
            endCallLocally("Partner disconnected");
            break;
        case "time_limit_reached":
            endCallLocally("Call ended (10-min limit)");
            break;
    }
};

async function processSignalingMessage(data) {
    if (data.type === "offer") await handleOffer(data);
    if (data.type === "answer") await handleAnswer(data);
    if (data.type === "ice_candidate") await handleNewICECandidateMsg(data);
}

async function startCall(isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === "disconnected" || 
            peerConnection.iceConnectionState === "failed") {
            endCallLocally("Connection lost");
        }
    };

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(e => console.log("Audio block:", e));
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentPartnerId) {
            ws.send(JSON.stringify({
                type: "ice_candidate", target: currentPartnerId, candidate: event.candidate
            }));
        }
    };

    if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", target: currentPartnerId, sdp: offer }));
    }

    while (signalingQueue.length > 0) {
        const msg = signalingQueue.shift();
        await processSignalingMessage(msg);
    }
}

async function handleOffer(data) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "answer", target: currentPartnerId, sdp: answer }));
}

async function handleAnswer(data) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
}

async function handleNewICECandidateMsg(data) {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch (e) {
        console.error("ICE Error:", e);
    }
}

btnNew.onclick = async () => {
    if (await ensureMicrophoneAccess()) {
        resetConnection();
        ws.send(JSON.stringify({ type: "connect_new" }));
    }
};

btnReconnect.onclick = async () => {
    if (await ensureMicrophoneAccess()) {
        resetConnection();
        ws.send(JSON.stringify({ type: "reconnect" }));
    }
};

btnMute.onclick = () => {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;
        btnMute.innerText = isMuted ? "Unmute" : "Mute";
    }
};

btnDisconnect.onclick = () => {
    ws.send(JSON.stringify({ type: "hangup" }));
    endCallLocally("Disconnected");
};

function resetConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    signalingQueue = [];
    remoteAudio.srcObject = null;
}

function endCallLocally(message) {
    resetConnection();
    currentPartnerId = null;
    updateUI(message, false, false);
}
