// Premium Audio Chat Frontend
// Built by Satyakam Swami

// ======================================================
// CLIENT ID
// ======================================================

let myId = localStorage.getItem("chat_uuid");

if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem("chat_uuid", myId);
}

// ======================================================
// WEBSOCKET
// ======================================================

const wsProtocol =
    window.location.protocol === "https:"
        ? "wss"
        : "ws";

const ws = new WebSocket(
    `${wsProtocol}://${window.location.host}/ws/${myId}`
);

// ======================================================
// GLOBALS
// ======================================================

let peerConnection = null;
let localStream = null;
let currentPartnerId = null;
let isMuted = false;

let signalingQueue = [];

let timerInterval = null;
let callSeconds = 0;

let speakerEnabled = true;

// ======================================================
// RTC CONFIG
// ======================================================

const rtcConfig = {
    iceServers: [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        }
    ]
};

// ======================================================
// UI ELEMENTS
// ======================================================

const statusText =
    document.getElementById("status-text");

const remoteAudio =
    document.getElementById("remote-audio");

const btnNew =
    document.getElementById("btn-new");

const btnReconnect =
    document.getElementById("btn-reconnect");

const btnMute =
    document.getElementById("btn-mute");

const btnDisconnect =
    document.getElementById("btn-disconnect");

const btnSpeaker =
    document.getElementById("btn-speaker");

const callControls =
    document.getElementById("call-controls");

const timerDisplay =
    document.getElementById("call-timer");

// ======================================================
// TIMER
// ======================================================

function startTimer() {

    clearInterval(timerInterval);

    callSeconds = 0;

    if (timerDisplay) {
        timerDisplay.style.display = "block";
    }

    timerInterval = setInterval(() => {

        callSeconds++;

        const mins =
            Math.floor(callSeconds / 60);

        const secs =
            callSeconds % 60;

        if (timerDisplay) {
            timerDisplay.innerText =
                `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        }

    }, 1000);
}

function stopTimer() {

    clearInterval(timerInterval);

    if (timerDisplay) {
        timerDisplay.style.display = "none";
    }
}

// ======================================================
// MICROPHONE ACCESS
// ======================================================

async function ensureMicrophoneAccess() {

    if (localStream) {
        return true;
    }

    try {

        statusText.innerText =
            "Status: Requesting Microphone...";

        localStream =
            await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });

        return true;

    } catch (error) {

        console.error(error);

        alert(
            "Microphone permission is required."
        );

        statusText.innerText =
            "Status: Disconnected";

        return false;
    }
}

// ======================================================
// WEBSOCKET EVENTS
// ======================================================

ws.onmessage = async (event) => {

    const data =
        JSON.parse(event.data);

    switch (data.type) {

        case "waiting":

            statusText.innerText =
                "Status: Waiting for new caller...";

            break;

        case "waiting_reconnect":

            statusText.innerText =
                "Status: Waiting for previous caller...";

            break;

        case "error":

            alert(data.message);

            statusText.innerText =
                "Status: Disconnected";

            break;

        case "matched":

            statusText.innerText =
                "Status: Connected";

            currentPartnerId =
                data.partner_id;

            startTimer();

            await startCall(
                data.initiator
            );

            break;

        case "offer":
        case "answer":
        case "ice_candidate":

            if (!peerConnection) {

                signalingQueue.push(data);

            } else {

                await processSignalingMessage(
                    data
                );
            }

            break;

        case "partner_left":

            endCallLocally(
                "Partner disconnected."
            );

            break;
    }
};

ws.onclose = () => {

    endCallLocally(
        "Server connection lost."
    );
};

ws.onerror = () => {

    console.log(
        "WebSocket Error"
    );
};

// ======================================================
// SIGNALING
// ======================================================

async function processSignalingMessage(data) {

    if (data.type === "offer") {
        await handleOffer(data);
    }

    if (data.type === "answer") {
        await handleAnswer(data);
    }

    if (data.type === "ice_candidate") {
        await handleICE(data);
    }
}

// ======================================================
// WEBRTC
// ======================================================

async function startCall(isInitiator) {

    callControls.style.display =
        "block";

    peerConnection =
        new RTCPeerConnection(
            rtcConfig
        );

    peerConnection.onconnectionstatechange =
        () => {

            const state =
                peerConnection.connectionState;

            console.log(
                "Connection State:",
                state
            );

            if (
                state === "failed" ||
                state === "disconnected" ||
                state === "closed"
            ) {

                endCallLocally(
                    "Connection lost."
                );
            }
        };

    localStream
        .getTracks()
        .forEach(track => {

            peerConnection.addTrack(
                track,
                localStream
            );

        });

    peerConnection.ontrack =
        (event) => {

            remoteAudio.srcObject =
                event.streams[0];

            remoteAudio
                .play()
                .catch(console.error);
        };

    peerConnection.onicecandidate =
        (event) => {

            if (
                event.candidate &&
                currentPartnerId
            ) {

                ws.send(
                    JSON.stringify({
                        type: "ice_candidate",
                        target: currentPartnerId,
                        candidate: event.candidate
                    })
                );
            }
        };

    if (isInitiator) {

        const offer =
            await peerConnection.createOffer();

        await peerConnection.setLocalDescription(
            offer
        );

        ws.send(
            JSON.stringify({
                type: "offer",
                target: currentPartnerId,
                sdp: offer
            })
        );
    }

    while (
        signalingQueue.length > 0
    ) {

        const msg =
            signalingQueue.shift();

        await processSignalingMessage(
            msg
        );
    }
}

// ======================================================
// OFFER
// ======================================================

async function handleOffer(data) {

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(
            data.sdp
        )
    );

    const answer =
        await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(
        answer
    );

    ws.send(
        JSON.stringify({
            type: "answer",
            target: currentPartnerId,
            sdp: answer
        })
    );
}

// ======================================================
// ANSWER
// ======================================================

async function handleAnswer(data) {

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(
            data.sdp
        )
    );
}

// ======================================================
// ICE
// ======================================================

async function handleICE(data) {

    try {

        if (
            data.candidate &&
            peerConnection
        ) {

            await peerConnection.addIceCandidate(
                new RTCIceCandidate(
                    data.candidate
                )
            );
        }

    } catch (error) {

        console.error(
            "ICE Error:",
            error
        );
    }
}

// ======================================================
// BUTTONS
// ======================================================

btnNew.onclick = async () => {

    if (
        await ensureMicrophoneAccess()
    ) {

        cleanupBeforeSearch();

        ws.send(
            JSON.stringify({
                type: "connect_new"
            })
        );
    }
};

btnReconnect.onclick = async () => {

    if (
        await ensureMicrophoneAccess()
    ) {

        cleanupBeforeSearch();

        ws.send(
            JSON.stringify({
                type: "reconnect"
            })
        );
    }
};

btnMute.onclick = () => {

    if (!localStream) return;

    isMuted = !isMuted;

    localStream
        .getAudioTracks()[0]
        .enabled = !isMuted;

    btnMute.innerText =
        isMuted
            ? "Unmute Mic"
            : "Mute Mic";
};

btnSpeaker.onclick = () => {

    speakerEnabled =
        !speakerEnabled;

    remoteAudio.muted =
        !speakerEnabled;

    btnSpeaker.innerText =
        speakerEnabled
            ? "Speaker"
            : "Speaker Off";
};

btnDisconnect.onclick = () => {

    if (
        ws.readyState ===
        WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify({
                type: "hangup"
            })
        );
    }

    endCallLocally(
        "You disconnected."
    );
};

// ======================================================
// CLEANUP
// ======================================================

function cleanupBeforeSearch() {

    stopTimer();

    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;
    }

    signalingQueue = [];

    remoteAudio.srcObject = null;

    currentPartnerId = null;

    callControls.style.display =
        "none";
}

function endCallLocally(message) {

    stopTimer();

    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;
    }

    currentPartnerId = null;

    remoteAudio.srcObject = null;

    signalingQueue = [];

    callControls.style.display =
        "none";

    statusText.innerText =
        "Status: " + message;
}
