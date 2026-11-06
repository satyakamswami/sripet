# Production-Ready Backend built by Satyakam Swami - Enhanced Edition with 10-Min Timer
import json
import logging
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - [%(levelname)s] - %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("AudioChatServer")

app = FastAPI(title="Sripet Audio Chat Signaling Server 2.0")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}  
        self.waiting_queue: list[str] = []       
        self.reconnect_queue: list[str] = []     
        self.history: dict[str, str] = {}        
        self.current_pairs: dict[str, str] = {}  
        self.active_timers: dict[str, asyncio.Task] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"Client Connected: {client_id} | Total Online: {len(self.active_connections)}")

    async def disconnect(self, client_id: str) -> str | None:
        self.active_connections.pop(client_id, None)
        
        if client_id in self.waiting_queue:
            self.waiting_queue.remove(client_id)
        if client_id in self.reconnect_queue:
            self.reconnect_queue.remove(client_id)
        
        self.cancel_call_timer(client_id)
        
        partner_id = self.current_pairs.pop(client_id, None)
        if partner_id:
            self.current_pairs.pop(partner_id, None)
            self.cancel_call_timer(partner_id)
            logger.info(f"Call Ended: {client_id} dropped. Notifying partner {partner_id}")
            return partner_id
            
        logger.info(f"Client Disconnected: {client_id} | Total Online: {len(self.active_connections)}")
        return None

    async def send_message(self, client_id: str, message: dict):
        websocket = self.active_connections.get(client_id)
        if websocket:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                logger.warning(f"Dead socket detected for {client_id}: {e}. Pruning connection.")
                await self.disconnect(client_id)

    def start_call_timer(self, client_a: str, client_b: str):
        """Starts a 10-minute (600 seconds) auto-disconnect countdown for the matched pair."""
        self.cancel_call_timer(client_a)
        self.cancel_call_timer(client_b)

        async def timer_task():
            try:
                await asyncio.sleep(600)  # 10 Minutes
                logger.info(f"10-Min Limit Reached for {client_a} <---> {client_b}. Disconnecting call.")
                
                self.current_pairs.pop(client_a, None)
                self.current_pairs.pop(client_b, None)
                
                await self.send_message(client_a, {"type": "time_limit_reached"})
                await self.send_message(client_b, {"type": "time_limit_reached"})
            except asyncio.CancelledError:
                pass

        task = asyncio.create_task(timer_task())
        self.active_timers[client_a] = task
        self.active_timers[client_b] = task

    def cancel_call_timer(self, client_id: str):
        task = self.active_timers.pop(client_id, None)
        if task and not task.done():
            task.cancel()

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
                if client_id in manager.waiting_queue:
                    await manager.send_message(client_id, {"type": "waiting"})
                    continue
                
                old_partner = manager.current_pairs.pop(client_id, None)
                if old_partner:
                    manager.current_pairs.pop(old_partner, None)
                    manager.cancel_call_timer(client_id)
                    manager.cancel_call_timer(old_partner)
                    await manager.send_message(old_partner, {"type": "partner_left"})

                valid_partner = None
                while manager.waiting_queue:
                    possible_partner = manager.waiting_queue.pop(0)
                    if possible_partner != client_id and possible_partner in manager.active_connections:
                        valid_partner = possible_partner
                        break
                
                if valid_partner:
                    manager.current_pairs[client_id] = valid_partner
                    manager.current_pairs[valid_partner] = client_id
                    manager.history[client_id] = valid_partner
                    manager.history[valid_partner] = client_id

                    logger.info(f"Match Found: {client_id} <---> {valid_partner}")

                    manager.start_call_timer(client_id, valid_partner)

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
                
                if last_partner in manager.reconnect_queue:
                    manager.reconnect_queue.remove(last_partner)
                    manager.current_pairs[client_id] = last_partner
                    manager.current_pairs[last_partner] = client_id
                    
                    logger.info(f"Reconnected: {client_id} <---> {last_partner}")
                    
                    manager.start_call_timer(client_id, last_partner)
                    
                    await manager.send_message(client_id, {"type": "matched", "partner_id": last_partner, "initiator": True})
                    await manager.send_message(last_partner, {"type": "matched", "partner_id": client_id, "initiator": False})
                else:
                    if client_id not in manager.reconnect_queue:
                        manager.reconnect_queue.append(client_id)
                    await manager.send_message(client_id, {"type": "waiting_reconnect"})

            elif msg_type in ["offer", "answer", "ice_candidate"]:
                target_id = message.get("target")
                if target_id and target_id in manager.active_connections:
                    await manager.send_message(target_id, message)

            elif msg_type == "hangup":
                manager.cancel_call_timer(client_id)
                partner_id = manager.current_pairs.pop(client_id, None)
                if partner_id:
                    manager.current_pairs.pop(partner_id, None)
                    manager.cancel_call_timer(partner_id)
                    await manager.send_message(partner_id, {"type": "partner_left"})
                    logger.info(f"Hangup: {client_id} ended call with {partner_id}")

    except WebSocketDisconnect:
        partner_id = await manager.disconnect(client_id)
        if partner_id:
            await manager.send_message(partner_id, {"type": "partner_left"})
            
    except Exception as e:
        logger.error(f"Unexpected Error for {client_id}: {e}")
        partner_id = await manager.disconnect(client_id)
        if partner_id:
            await manager.send_message(partner_id, {"type": "partner_left"})
