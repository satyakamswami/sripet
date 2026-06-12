// Production-Ready Frontend Logic built by Satyakam Swami

// 1. Generate or retrieve a persistent unique client ID
let myId = localStorage.getItem('chat_uuid');
if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem('chat_uuid', myId);
}

// 2. Establish Secure/Standard WebSocket Communication Pipeline
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/${myId}`);

let peerConnection = null;
let localStream = null;
let currentPartnerId = null;
let isMuted = false;
let signalingQueue = []; // Queue processing structure for incoming signaling data

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// UI Element Mapping
const statusText = document.getElementById("status-text");
const remoteAudio = document.getElementById("remote-audio");
const btnNew = document.getElementById("btn-new");
const btnReconnect = document.getElementById("btn-reconnect");
const callControls = document.getElementById("call-controls");
const btnMute = document.getElementById("btn-mute");
const btnDisconnect = document.getElementById("btn-disconnect");

// 3. User Gesture Microphone Acquisition
async function ensureMicrophoneAccess() {
    if (localStream) return true; 

    try {
        statusText.innerText = "Status: Requesting Microphone...";
        // Explicitly requesting access inside the event execution path
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return true;
    } catch (error) {
        console.error("Microphone Access Error:", error);
        alert("Microphone access is mandatory for voice communications. Please check site permissions.");
        statusText.innerText = "Status: Disconnected";
        return false;
    }
}

// 4. Inbound WebSocket Message Routing System
ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch(data.type) {
        case "waiting":
            statusText.innerText = "Status: Waiting for a new partner...";
            break;
        case "waiting_reconnect":
            statusText.innerText = "Status: Waiting for previous partner...";
            break;
        case "error":
            alert(data.message);
            statusText.innerText = "Status: Disconnected";
            break;
        case "matched":
            statusText.innerText = "Status: Connected!";
            currentPartnerId = data.partner_id;
            await startCall(data.initiator);
            break;
        case "offer":
        case "answer":
        case "ice_candidate":
            // Hold data if peer connection initialization is pending
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
    callControls.style.display = "block";
    
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Mount user tracks onto the layout stream
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Handle inbound incoming partner stream assignments
    peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
        // Bypassing automated block restrictions via programmatic invocation execution
        remoteAudio.play().catch(e => console.log("Audio presentation blocked:", e));
    };

    // Forward local ice routing structural candidates to client target
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentPartnerId) {
            ws.send(JSON.stringify({
                type: "ice_candidate",
                target: currentPartnerId,
                candidate: event.candidate
            }));
        }
    };

    // Initiator establishes connection offer criteria setup
    if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({
            type: "offer",
            target: currentPartnerId,
            sdp: offer
        }));
    }

    // Flush out lingering delayed messages from cache structure allocations
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
    
    ws.send(JSON.stringify({
        type: "answer",
        target: currentPartnerId,
        sdp: answer
    }));
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
        console.error("Error setting ICE candidate parameter structures:", e);
    }
}

// 6. Action Button Interactive Listeners
btnNew.onclick = async () => {
    if (await ensureMicrophoneAccess()) {
        // CLEANUP: Drop local active session traces before pushing up connection updates
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        signalingQueue = [];
        remoteAudio.srcObject = null;
        
        ws.send(JSON.stringify({ type: "connect_new" }));
    }
};

btnReconnect.onclick = async () => {
    if (await ensureMicrophoneAccess()) {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        signalingQueue = [];
        remoteAudio.srcObject = null;

        ws.send(JSON.stringify({ type: "reconnect" }));
    }
};

btnMute.onclick = () => {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;
        btnMute.innerText = isMuted ? "Unmute Mic" : "Mute Mic";
    }
};

btnDisconnect.onclick = () => {
    ws.send(JSON.stringify({ type: "hangup" }));
    endCallLocally("You disconnected.");
};

function endCallLocally(message) {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    currentPartnerId = null;
    callControls.style.display = "none";
    statusText.innerText = "Status: " + message;
    remoteAudio.srcObject = null;
    signalingQueue = [];
    // Note: localStream remains active so subsequent matches don't prompt UI access popups repeatedly
}
