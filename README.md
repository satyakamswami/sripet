# Sripet 🎙️

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerToPeer-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)
[![Render](https://img.shields.io/badge/Render-Hosting-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com/)

**Sripet** is a zero-login, peer-to-peer 1-on-1 voice calling web application. Built with a high-end monochromatic aesthetic, it connects strangers instantly through real-time audio streams powered by WebSockets signaling and WebRTC media channels.

---

## ✨ Features

* **Zero-Login Matchmaking:** Instant peer pairing with no authentication required.
* **Peer-to-Peer Audio Streaming:** Low-latency 1-on-1 voice calls powered by browser-native WebRTC.
* **10-Minute Call Limit:** Automatic countdown timer with server-enforced and client-synchronized call auto-disconnection.
* **In-Call Controls:** Real-time audio track muting/unmuting, partner disconnection, and last-partner reconnection functionality.
* **Robust Matchmaking Queue:** Thread-safe connection state manager in FastAPI handling concurrent user pairing and dropped socket pruning.
* **Editorial Monochromatic UI:** High-end, minimal interface optimized for both desktop and mobile viewports.

---

## 🛠️ Tech Stack

* **Backend:** Python, FastAPI, Uvicorn, WebSockets (Signaling Server)
* **Frontend:** HTML5, Modern CSS3 (Dynamic Viewport Sizing), Vanilla JavaScript
* **Protocols:** WebRTC (RTCPeerConnection via Google STUN servers), WSS / WS
* **Deployment:** Render (ASGI Worker via Uvicorn)

---

## 📦 Project Structure

```text
Sripet - audio chat/
│
├── main.py              # FastAPI server & ConnectionManager matchmaking logic
├── requirements.txt     # Python dependencies
├── Procfile             # Render deployment configuration
│
├── static/
│   ├── script.js        # WebRTC audio stream & WebSocket client logic
│   └── style.css        # Monochromatic UI stylesheet
│
└── templates/
    └── index.html       # Single-page interface template
```

---

## 🚀 Local Setup & Installation

Follow these steps to run **Sripet** locally on your machine.

### Prerequisites

* Python 3.10 or higher installed.
* Microphone access enabled in your browser.

### 1. Clone the Repository

```bash
git clone https://github.com/satyakamswami/sripet-audio-chat.git
cd sripet-audio-chat
```

### 2. Set Up Virtual Environment

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows (PowerShell):
.\venv\Scripts\Activate
# On macOS/Linux:
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the Application

```bash
uvicorn main:app --reload
```

### 5. Test Call Connection

1. Open **`http://127.0.0.1:8000`** in a browser tab.
2. Open **`http://127.0.0.1:8000`** in a second browser tab (or Incognito window).
3. Click **Start Call** in both tabs to initiate the peer-to-peer connection.

---

## 🌐 Cloud Deployment (Render)

1. Push your code to GitHub with the root `Procfile`:
   ```text
   web: uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
2. Create a new **Web Service** on [Render](https://dashboard.render.com/).
3. Connect your **Sripet** repository.
4. Set the build parameters:
   * **Runtime:** `Python 3`
   * **Build Command:** `pip install -r requirements.txt`
   * **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Deploy and access via your HTTPS `.onrender.com` URL (HTTPS is required for WebRTC microphone permissions).

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
