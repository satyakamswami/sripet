import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# 1. Configure Professional Logging
# This allows you to monitor matches, drops, and server health in your terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - [%(levelname)s] - %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("AudioChatServer")

app = FastAPI(title="Audio Chat Signaling Server 2.0")

# Mount static files and templates folders
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class ConnectionManager:
    def __init__(self):
        # Added Type Hinting for cleaner development and IDE support
        self.active_connections: dict[str, WebSocket] = {}  
        self.waiting_queue: list[str] = []       
        self.reconnect_queue: list[str] = []     
        self.history: dict[str, str] = {}        
        self.current_pairs: dict[str, str] = {}  

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"Client Connected: {client_id} | Total Online: {len(self.active_connections)}")

    async def disconnect(self, client_id: str) -> str | None:
        """Safely removes client, cleans all queues, and returns partner ID if they were in a call."""
        self.active_connections.pop(client_id, None)
        
        if client_id in self.waiting_queue:
            self.waiting_queue.remove(client_id)
        if client_id in self.reconnect_queue:
            self.reconnect_queue.remove(client_id)
        
        # Clean up pair associations and notify their partner
        partner_id = self.current_pairs.pop(client_id, None)
        if partner_id:
            self.current_pairs.pop(partner_id, None)
            logger.info(f"Call Ended: {client_id} dropped. Notifying partner {partner_id}")
            return partner_id
            
        logger.info(f"Client Disconnected: {client_id} | Total Online: {len(self.active_connections)}")
        return None

    async def send_message(self, client_id: str, message: dict):
        """Attempts to send a message. If it fails, assumes the socket is dead and prunes it."""
        websocket = self.active_connections.get(client_id)
        if websocket:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                logger.warning(f"Dead socket detected for {client_id}: {e}. Pruning connection.")
                # Force cleanup if socket is unresponsive mid-flight
                await self.disconnect(client_id)

manager = ConnectionManager()

@app.get("/")
async def get(request: Request):
    # Explicitly define request and name as kwargs to bypass signature changes
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
                # PROTECTION 1: Prevent duplicate queuing requests
                if client_id in manager.waiting_queue:
                    await manager.send_message(client_id, {"type": "waiting"})
                    continue
                
                # CLEANUP: Break lingering previous sessions
                old_partner = manager.current_pairs.pop(client_id, None)
                if old_partner:
                    manager.current_pairs.pop(old_partner, None)
                    await manager.send_message(old_partner, {"type": "partner_left"})

                # Matchmaking scanning process
                valid_partner = None
                while manager.waiting_queue:
                    possible_partner = manager.waiting_queue.pop(0)
                    
                    # PROTECTION 2: Ensure partner is online and NOT the user themselves
                    if possible_partner != client_id and possible_partner in manager.active_connections:
                        valid_partner = possible_partner
                        break
                
                if valid_partner:
                    # Establish pairing maps
                    manager.current_pairs[client_id] = valid_partner
                    manager.current_pairs[valid_partner] = client_id
                    manager.history[client_id] = valid_partner
                    manager.history[valid_partner] = client_id

                    logger.info(f"Match Found: {client_id} <---> {valid_partner}")

                    # Assign roles: client_id becomes initiator
                    await manager.send_message(client_id, {"type": "matched", "partner_id": valid_partner, "initiator": True})
                    await manager.send_message(valid_partner, {"type": "matched", "partner_id": client_id, "initiator": False})
                else:
                    manager.waiting_queue.append(client_id)
                    await manager.send_message(client_id, {"type": "waiting"})

            elif msg_type == "reconnect":
                last_partner = manager.history.get(client_id)
                if not last_partner:
                    await manager.send_message(client_id, {"type": "error", "message": "No previous partner history found."})
                    continue
                
                # Check if old partner is waiting to reconnect
                if last_partner in manager.reconnect_queue:
                    manager.reconnect_queue.remove(last_partner)
                    manager.current_pairs[client_id] = last_partner
                    manager.current_pairs[last_partner] = client_id
                    
                    logger.info(f"Reconnected: {client_id} <---> {last_partner}")
                    
                    await manager.send_message(client_id, {"type": "matched", "partner_id": last_partner, "initiator": True})
                    await manager.send_message(last_partner, {"type": "matched", "partner_id": client_id, "initiator": False})
                else:
                    if client_id not in manager.reconnect_queue:
                        manager.reconnect_queue.append(client_id)
                    await manager.send_message(client_id, {"type": "waiting_reconnect"})

            # WebRTC Media Signaling Relay
            elif msg_type in ["offer", "answer", "ice_candidate"]:
                target_id = message.get("target")
                if target_id and target_id in manager.active_connections:
                    await manager.send_message(target_id, message)

            elif msg_type == "hangup":
                partner_id = manager.current_pairs.pop(client_id, None)
                if partner_id:
                    manager.current_pairs.pop(partner_id, None)
                    await manager.send_message(partner_id, {"type": "partner_left"})
                    logger.info(f"Hangup: {client_id} ended call with {partner_id}")

    except WebSocketDisconnect:
        # Standard graceful disconnect (e.g., user refreshed page or closed tab)
        partner_id = await manager.disconnect(client_id)
        if partner_id:
            await manager.send_message(partner_id, {"type": "partner_left"})
            
    except Exception as e:
        # Catch-all for unexpected network failures or malformed JSON
        logger.error(f"Unexpected Error for {client_id}: {e}")
        partner_id = await manager.disconnect(client_id)
        if partner_id:
            await manager.send_message(partner_id, {"type": "partner_left"})
