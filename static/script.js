// Satyakam Swami - WebRTC Frontend Logic

// 1. Generate or retrieve UUID for the user
let myId = localStorage.getItem('chat_uuid');
if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem('chat_uuid', myId);
}

// 2. Setup WebSocket and Variables
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/${myId}`);

let peerConnection;
let localStream;
let currentPartnerId = null;
let isMuted = false;

// FIX: A queue to hold messages if they arrive before the mic is ready
let signalingQueue = []; 

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// UI Elements
const statusText = document.getElementById("status-text");
const remoteAudio = document.getElementById("remote-audio");
const btnNew = document.getElementById("btn-new");
const btnReconnect = document.getElementById("btn-reconnect");
const callControls = document.getElementById("call-controls");
const btnMute = document.getElementById("btn-mute");
const btnDisconnect = document.getElementById("btn-disconnect");

// 3. WebSocket Message Handling
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
            // FIX: If the connection isn't ready yet, queue the message!
            if (!peerConnection) {
                console.log("Mic not ready yet, queuing message:", data.type);
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

// Helper function to process the WebRTC messages
async function processSignalingMessage(data) {
    if (data.type === "offer") await handleOffer(data);
    if (data.type === "answer") await handleAnswer(data);
    if (data.type === "ice_candidate") await handleNewICECandidateMsg(data);
}

// 4. WebRTC Call Logic
async function startCall(isInitiator) {
    callControls.style.display = "block";
    
    // Get microphone access (This is the step that takes time!)
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add our audio to the connection
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // When we get their audio, play it
    peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
        // FIX: Force the browser to play the audio to bypass Autoplay blocks
        remoteAudio.play().catch(e => console.log("Audio play blocked by browser:", e));
    };

    // Send routing info (ICE) to the other person
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: "ice_candidate",
                target: currentPartnerId,
                candidate: event.candidate
            }));
        }
    };

    // If we are the ones who were in the queue first, we send the Offer
    if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({
            type: "offer",
            target: currentPartnerId,
            sdp: offer
        }));
    }

    // FIX: Now that our mic is ON and peerConnection is ready, process any queued messages!
    while (signalingQueue.length > 0) {
        const msg = signalingQueue.shift();
        console.log("Processing queued message:", msg.type);
        await processSignalingMessage(msg);
    }
}

async function handleOffer(data) {
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
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
}

async function handleNewICECandidateMsg(data) {
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch (e) {
        console.error("Error adding ICE candidate", e);
    }
}

// 5. Button Listeners
btnNew.onclick = () => {
    ws.send(JSON.stringify({ type: "connect_new" }));
};

btnReconnect.onclick = () => {
    ws.send(JSON.stringify({ type: "reconnect" }));
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
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    currentPartnerId = null;
    callControls.style.display = "none";
    statusText.innerText = "Status: " + message;
    remoteAudio.srcObject = null;
    signalingQueue = []; // Clear the queue on disconnect
}
