# Backend built by Satyakam Swami
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import json

app = FastAPI(title="Audio Chat Signaling Server")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class ConnectionManager:
    def __init__(self):
        self.active_connections = {}  # client_id: websocket
        self.waiting_queue = []       # list of client_ids waiting for new call
        self.reconnect_queue = []     # list of client_ids waiting to reconnect
        self.history = {}             # client_id: last_partner_id
        self.current_pairs = {}       # client_id: partner_id

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.waiting_queue:
            self.waiting_queue.remove(client_id)
        if client_id in self.reconnect_queue:
            self.reconnect_queue.remove(client_id)
        
        # If they were in a call, notify the partner
        partner_id = self.current_pairs.get(client_id)
        if partner_id:
            self.current_pairs.pop(client_id, None)
            self.current_pairs.pop(partner_id, None)
            return partner_id
        return None

    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(json.dumps(message))

manager = ConnectionManager()

@app.get("/")
async def get(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(client_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type")

            if msg_type == "connect_new":
                if manager.waiting_queue:
                    # Match found!
                    partner_id = manager.waiting_queue.pop(0)
                    
                    # Save pairs and history
                    manager.current_pairs[client_id] = partner_id
                    manager.current_pairs[partner_id] = client_id
                    manager.history[client_id] = partner_id
                    manager.history[partner_id] = client_id

                    # Tell both clients they matched. client_id will be the "caller"
                    await manager.send_message(client_id, {"type": "matched", "partner_id": partner_id, "initiator": True})
                    await manager.send_message(partner_id, {"type": "matched", "partner_id": client_id, "initiator": False})
                else:
                    # Nobody waiting, join queue
                    manager.waiting_queue.append(client_id)
                    await manager.send_message(client_id, {"type": "waiting"})

            elif msg_type == "reconnect":
                last_partner = manager.history.get(client_id)
                if not last_partner:
                    await manager.send_message(client_id, {"type": "error", "message": "No previous partner found."})
                    continue
                
                if last_partner in manager.reconnect_queue:
                    # Partner is also waiting to reconnect! Match them.
                    manager.reconnect_queue.remove(last_partner)
                    manager.current_pairs[client_id] = last_partner
                    manager.current_pairs[last_partner] = client_id
                    
                    await manager.send_message(client_id, {"type": "matched", "partner_id": last_partner, "initiator": True})
                    await manager.send_message(last_partner, {"type": "matched", "partner_id": client_id, "initiator": False})
                else:
                    # Wait in reconnect queue
                    manager.reconnect_queue.append(client_id)
                    await manager.send_message(client_id, {"type": "waiting_reconnect"})

            # WebRTC Signaling routing
            elif msg_type in ["offer", "answer", "ice_candidate"]:
                target_id = message.get("target")
                if target_id:
                    await manager.send_message(target_id, message)

            elif msg_type == "hangup":
                partner_id = manager.current_pairs.pop(client_id, None)
                if partner_id:
                    manager.current_pairs.pop(partner_id, None)
                    await manager.send_message(partner_id, {"type": "partner_left"})

    except WebSocketDisconnect:
        partner_id = manager.disconnect(client_id)
        if partner_id:
            await manager.send_message(partner_id, {"type": "partner_left"})
