// Production-Ready Frontend Logic built by Satyakam Swami - Enhanced Edition

// 1. Generate or retrieve a persistent unique client ID
let myId = localStorage.getItem('chat_uuid') || crypto.randomUUID();
localStorage.setItem('chat_uuid', myId);

// 2. Establish Secure/Standard WebSocket Communication Pipeline
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
let ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/${myId}`);

let peerConnection = null;
let localStream = null;
let currentPartnerId = null;
let isMuted = false;
let signalingQueue = []; 

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// UI Element Mapping
const statusText = document.getElementById("status-text");
const remoteAudio = document.getElementById("remote-audio");
const btnNew = document.getElementById("btn-new");
const btnReconnect = document.getElementById("btn-reconnect");
const callControls = document.getElementById("call-controls");
const mainControls = document.getElementById("main-controls");
const btnMute = document.getElementById("btn-mute");
const btnDisconnect = document.getElementById("btn-disconnect");
const pulseRing = document.getElementById("pulse-ring");

// Helper function to update UI seamlessly
function updateUI(status, showCallControls, animatePulse) {
    statusText.innerHTML = status;
    callControls.style.display = showCallControls ? "block" : "none";
    mainControls.style.display = showCallControls ? "none" : "block";
    
    if (animatePulse) {
        pulseRing.classList.add("active");
    } else {
        pulseRing.classList.remove("active");
    }
}

// 3. User Gesture Microphone Acquisition
async function ensureMicrophoneAccess() {
    if (localStream) return true; 

    try {
        updateUI("<i class='fa-solid fa-spinner fa-spin'></i> Requesting Microphone...", false, false);
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return true;
    } catch (error) {
        console.error("Microphone Access Error:", error);
        alert("Microphone access is mandatory. Please check browser permissions.");
        updateUI("Disconnected", false, false);
        return false;
    }
}

// 4. Inbound WebSocket Message Routing System
ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch(data.type) {
        case "waiting":
            updateUI("<i class='fa-solid fa-satellite-dish fa-fade'></i> Searching for partner...", false, true);
            break;
        case "waiting_reconnect":
            updateUI("<i class='fa-solid fa-clock-rotate-left fa-spin'></i> Awaiting previous partner...", false, true);
            break;
        case "error":
            alert(data.message);
            updateUI("Disconnected", false, false);
            break;
        case "matched":
            updateUI("<i class='fa-solid fa-link'></i> Connected!", true, true);
            currentPartnerId = data.partner_id;
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
            endCallLocally("Partner disconnected.");
            break;
    }
};

async function processSignalingMessage(data) {
    if (data.type === "offer") await handleOffer(data);
    if (data.type === "answer") await handleAnswer(data);
    if (data.type === "ice_candidate") await handleNewICECandidateMsg(data);
}

// 5. Asynchronous WebRTC Connection Lifecycle
async function startCall(isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // CRITICAL IMPROVEMENT: Monitor connection drops
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === "disconnected" || 
            peerConnection.iceConnectionState === "failed") {
            endCallLocally("Connection lost.");
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

// 6. Action Button Interactive Listeners
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
        btnMute.innerHTML = isMuted ? "<i class='fa-solid fa-microphone-slash'></i> Unmute" : "<i class='fa-solid fa-microphone'></i> Mute";
        btnMute.className = isMuted ? "btn-secondary" : "btn-warning";
    }
};

btnDisconnect.onclick = () => {
    ws.send(JSON.stringify({ type: "hangup" }));
    endCallLocally("You disconnected.");
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
