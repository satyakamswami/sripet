# Premium Audio Chat Backend
# Built by Satyakam Swami

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import json

app = FastAPI(title="Premium Audio Chat")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


class ConnectionManager:
    def __init__(self):
        self.active_connections = {}
        self.waiting_queue = []
        self.reconnect_queue = []
        self.history = {}
        self.current_pairs = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):

        self.active_connections.pop(client_id, None)

        if client_id in self.waiting_queue:
            self.waiting_queue.remove(client_id)

        if client_id in self.reconnect_queue:
            self.reconnect_queue.remove(client_id)

        partner_id = self.current_pairs.pop(client_id, None)

        if partner_id:
            self.current_pairs.pop(partner_id, None)
            return partner_id

        return None

    async def send_message(self, client_id: str, message: dict):

        websocket = self.active_connections.get(client_id)

        if websocket:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception:
                pass


manager = ConnectionManager()


@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    client_id: str
):

    await manager.connect(client_id, websocket)

    try:

        while True:

            data = await websocket.receive_text()
            message = json.loads(data)

            msg_type = message.get("type")

            # --------------------------------------------------
            # CONNECT NEW
            # --------------------------------------------------

            if msg_type == "connect_new":

                if client_id in manager.waiting_queue:
                    await manager.send_message(
                        client_id,
                        {"type": "waiting"}
                    )
                    continue

                if client_id in manager.reconnect_queue:
                    manager.reconnect_queue.remove(client_id)

                old_partner = manager.current_pairs.pop(
                    client_id,
                    None
                )

                if old_partner:

                    manager.current_pairs.pop(
                        old_partner,
                        None
                    )

                    await manager.send_message(
                        old_partner,
                        {
                            "type": "partner_left"
                        }
                    )

                valid_partner = None

                while manager.waiting_queue:

                    possible_partner = (
                        manager.waiting_queue.pop(0)
                    )

                    if (
                        possible_partner != client_id
                        and possible_partner
                        in manager.active_connections
                    ):
                        valid_partner = possible_partner
                        break

                if valid_partner:

                    manager.current_pairs[
                        client_id
                    ] = valid_partner

                    manager.current_pairs[
                        valid_partner
                    ] = client_id

                    manager.history[
                        client_id
                    ] = valid_partner

                    manager.history[
                        valid_partner
                    ] = client_id

                    await manager.send_message(
                        client_id,
                        {
                            "type": "matched",
                            "partner_id": valid_partner,
                            "initiator": True
                        }
                    )

                    await manager.send_message(
                        valid_partner,
                        {
                            "type": "matched",
                            "partner_id": client_id,
                            "initiator": False
                        }
                    )

                else:

                    manager.waiting_queue.append(
                        client_id
                    )

                    await manager.send_message(
                        client_id,
                        {
                            "type": "waiting"
                        }
                    )

            # --------------------------------------------------
            # RECONNECT TO LAST CALLER
            # --------------------------------------------------

            elif msg_type == "reconnect":

                last_partner = manager.history.get(
                    client_id
                )

                if not last_partner:

                    await manager.send_message(
                        client_id,
                        {
                            "type": "error",
                            "message": (
                                "No previous caller found."
                            )
                        }
                    )

                    continue

                if (
                    last_partner
                    in manager.reconnect_queue
                    and last_partner
                    in manager.active_connections
                ):

                    manager.reconnect_queue.remove(
                        last_partner
                    )

                    manager.current_pairs[
                        client_id
                    ] = last_partner

                    manager.current_pairs[
                        last_partner
                    ] = client_id

                    await manager.send_message(
                        client_id,
                        {
                            "type": "matched",
                            "partner_id": last_partner,
                            "initiator": True
                        }
                    )

                    await manager.send_message(
                        last_partner,
                        {
                            "type": "matched",
                            "partner_id": client_id,
                            "initiator": False
                        }
                    )

                else:

                    if (
                        client_id
                        not in manager.reconnect_queue
                    ):
                        manager.reconnect_queue.append(
                            client_id
                        )

                    await manager.send_message(
                        client_id,
                        {
                            "type": "waiting_reconnect"
                        }
                    )

            # --------------------------------------------------
            # SIGNALING
            # --------------------------------------------------

            elif msg_type in [
                "offer",
                "answer",
                "ice_candidate"
            ]:

                target_id = message.get("target")

                if (
                    target_id
                    and target_id
                    in manager.active_connections
                ):
                    await manager.send_message(
                        target_id,
                        message
                    )

            # --------------------------------------------------
            # HANGUP
            # --------------------------------------------------

            elif msg_type == "hangup":

                partner_id = manager.current_pairs.pop(
                    client_id,
                    None
                )

                if partner_id:

                    manager.current_pairs.pop(
                        partner_id,
                        None
                    )

                    await manager.send_message(
                        partner_id,
                        {
                            "type": "partner_left"
                        }
                    )

    except WebSocketDisconnect:

        partner_id = manager.disconnect(
            client_id
        )

        if partner_id:

            await manager.send_message(
                partner_id,
                {
                    "type": "partner_left"
                }
            )
