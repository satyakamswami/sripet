// Generate a unique ID for this user
const clientId = Math.random().toString(36).substring(2, 15);

// Connect to the WebSocket automatically (handles both standard and secure connections)
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${clientId}`);

// WebRTC variables
let peerConnection;
let localStream;
let currentPartnerId = null;

// Free Google STUN server to help phones find each other over the internet
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// UI Elements
const statusText = document.getElementById('statusText');
const remoteAudio = document.getElementById('remoteAudio');
const btnNew = document.getElementById('btnNew');
const btnReconnect = document.getElementById('btnReconnect');
const btnHangup = document.getElementById('btnHangup');

// 1. Get Microphone Access immediately
navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
        localStream = stream;
        statusText.innerText = "Microphone active. Ready to connect!";
        btnNew.disabled = false;
        btnReconnect.disabled = false;
    })
    .catch(err => {
        statusText.innerText = "Microphone access denied! Please enable it.";
        console.error("Mic Error:", err);
    });

// 2. Handle incoming WebSocket messages from FastAPI
ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "waiting") {
        statusText.innerText = "Waiting for a random partner...";
        updateButtons("waiting");
    } 
    else if (msg.type === "waiting_reconnect") {
        statusText.innerText = "Waiting for previous partner...";
        updateButtons("waiting");
    } 
    else if (msg.type === "matched") {
        currentPartnerId = msg.partner_id;
        statusText.innerText = "Matched! Connecting audio...";
        updateButtons("connected");
        createPeerConnection();

        // The "initiator" starts the WebRTC handshake
        if (msg.initiator) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            // Send offer through your FastAPI server, including our ID as 'sender'
            ws.send(JSON.stringify({ type: "offer", target: currentPartnerId, sender: clientId, sdp: offer }));
        }
    } 
    else if (msg.type === "offer") {
        currentPartnerId = msg.sender;
        createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", target: currentPartnerId, sdp: answer }));
    } 
    else if (msg.type === "answer") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        statusText.innerText = "Connected! You can talk now.";
    } 
    else if (msg.type === "ice_candidate") {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {
            console.error("Error adding ice candidate", e);
        }
    } 
    else if (msg.type === "partner_left" || msg.type === "error") {
        statusText.innerText = msg.type === "error" ? msg.message : "Partner disconnected.";
        cleanupConnection();
        updateButtons("ready");
    }
};

// 3. WebRTC Peer Connection Setup
function createPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(configuration);

    // Add our microphone audio to the connection
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // When we receive the partner's audio, play it in the <audio> tag
    peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
    };

    // Send network routing data (ICE) to the partner via FastAPI
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: "ice_candidate",
                target: currentPartnerId,
                candidate: event.candidate
            }));
        }
    };
}

// 4. Teardown
function cleanupConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteAudio.srcObject = null;
    currentPartnerId = null;
}

// 5. Button Logic (Sending commands to FastAPI)
btnNew.onclick = () => ws.send(JSON.stringify({ type: "connect_new" }));
btnReconnect.onclick = () => ws.send(JSON.stringify({ type: "reconnect" }));
btnHangup.onclick = () => {
    ws.send(JSON.stringify({ type: "hangup" }));
    cleanupConnection();
    updateButtons("ready");
    statusText.innerText = "You hung up. Ready for a new call.";
};

// Helper to manage UI state
function updateButtons(state) {
    if (state === "ready") {
        btnNew.disabled = false;
        btnReconnect.disabled = false;
        btnHangup.disabled = true;
    } else if (state === "waiting") {
        btnNew.disabled = true;
        btnReconnect.disabled = true;
        btnHangup.disabled = false; // Allow cancelling wait
    } else if (state === "connected") {
        btnNew.disabled = true;
        btnReconnect.disabled = true;
        btnHangup.disabled = false;
    }
}