import { SDK_CONFIG } from "../config/ws";
import { ChatInput, ChatMessage, Events } from "../types/meeting";
import { MeetingState } from "./MeetingState";

export class VideoSDKCore {
  private ws: WebSocket | null = null;
  private peers: Record<string, RTCPeerConnection> = {};
  private initiators = new Set<string>();

  private myId: string;
  private roomId: string | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private isScreenSharing = false;
  private pingInterval: any = null;

  constructor(
    private state: MeetingState,
    private events: Events = {},
    private url: string = SDK_CONFIG.wsUrl,
  ) {
    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();

    localStorage.setItem("vsdk_id", this.myId);
  }

  // ---------------- STREAM ----------------
  async initLocal(video: HTMLVideoElement, name: string) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    video.srcObject = this.localStream;

    this.state.localParticipant = {
      id: this.myId,
      name,
      media: {
        cameraStream: this.localStream,
        screenStream: null,
        micEnabled: true,
        camEnabled: true,
        isScreenSharing: false,
      },
    };

    this.state.localStream = this.localStream;
  }

  // ---------------- CONNECT ----------------
  async connect(roomId: string, name: string) {
    this.roomId = roomId;

    this.reset();

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name,
        });

        this.startHeartbeat();

        resolve();
      };

      this.ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        reject(new Error("WebSocket connection failed"));
      };

      this.ws.onclose = (e) => {
        console.error("WebSocket Closed:", e.code, e.reason, e.wasClean);
      };

      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();

    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      this.send({
        type: "PING",
        client_ts: Date.now(),
      });
    }, 20000); // every 20s
  }
  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ---------------- RESET ----------------
  private reset() {
    Object.values(this.peers).forEach((pc) => pc.close());

    this.peers = {};

    this.state.reset();
  }

  // ---------------- HANDLE SIGNALS ----------------
  private async handle(msg: any) {
    if (msg.sender === this.myId) return;

    switch (msg.type) {
      case "EXISTING_USERS":
        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;

          this.state.addParticipant(p);

          this.events.onUserJoined?.(p);

          await this.createOffer(p.id);
        }
        break;

      case "USER_JOINED": {
        const p = msg.participant;

        if (!p?.id || p.id === this.myId) return;

        this.state.addParticipant(p);

        this.events.onUserJoined?.(p);

        break;
      }

      case "OFFER":
        await this.handleOffer(msg.payload, msg.sender);
        break;

      case "ANSWER": {
        const pc = this.peers[msg.sender];

        if (!pc) return;

        if (pc.signalingState !== "have-local-offer") {
          console.warn("Ignoring invalid answer:", pc.signalingState);
          return;
        }

        await pc.setRemoteDescription({
          type: "answer",
          sdp: msg.payload,
        });

        break;
      }

      case "ICE":
        try {
          await this.peers[msg.sender]?.addIceCandidate(
            JSON.parse(msg.payload),
          );
        } catch (err) {
          console.warn("ICE error:", err);
        }
        break;

      case "USER_LEFT":
        const peerId = msg.participant.id;
        this.closePeer(peerId);

        this.state.removeParticipant(peerId);

        this.events.onUserLeft?.(peerId);

        break;
      case "CHAT_MESSAGE": {
        const newMsg = msg.data;

        if (newMsg.sender_id === this.myId) break; // already added optimistically
        this.state.addChatMessage({
          ...newMsg,
          text: newMsg.message,
          sender_id: newMsg.sender_id,
          sender_name: newMsg.sender_name,
          timestamp: new Date(newMsg.timestamp).getTime(),
        });

        this.events.onChatMessage?.(msg);
        break;
      }
      case "SCREEN_SHARE_START": {
        this.events.onScreenShareStarted?.(
          msg.sender,
          this.state.getStreamById(msg.sender)!,
        );
        break;
      }

      case "SCREEN_SHARE_STOP": {
        this.events.onScreenShareStopped?.(msg.sender);
        break;
      }
    }
  }

  // ---------------- PEER ----------------
  private createPeer(id: string) {
    if (!this.localStream) {
      throw new Error("No local stream");
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!);
    });

    pc.ontrack = (e) => {
      this.state.setStream(id, e.streams[0]);

      this.events.onTrack?.(e.streams[0], id);
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;

      this.send({
        type: "ICE",
        payload: JSON.stringify(e.candidate),
        sender: this.myId,
        target: id,
      });
    };

    return pc;
  }

  // ---------------- OFFER ----------------
  private async createOffer(id: string) {
    if (this.initiators.has(id)) return;

    this.initiators.add(id);

    if (!this.peers[id]) {
      this.peers[id] = this.createPeer(id);
    }

    const pc = this.peers[id];

    if (pc.signalingState !== "stable") {
      return;
    }

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    this.send({
      type: "OFFER",
      payload: offer.sdp,
      sender: this.myId,
      target: id,
    });
  }

  // ---------------- ANSWER ----------------
  private async handleOffer(sdp: string, id: string) {
    if (!this.peers[id]) {
      this.peers[id] = this.createPeer(id);
    }

    const pc = this.peers[id];

    await pc.setRemoteDescription({
      type: "offer",
      sdp,
    });

    const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    this.send({
      type: "ANSWER",
      payload: answer.sdp,
      sender: this.myId,
      target: id,
    });
  }

  // ---------------- CLEANUP ----------------
  private closePeer(id: string) {
    this.peers[id]?.close();

    delete this.peers[id];

    this.initiators.delete(id);

    this.state.removeStream(id);
  }

  async startScreenShare() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    this.isScreenSharing = true;

    // Replace video track in all peer connections
    const videoTrack = this.screenStream.getVideoTracks()[0];

    Object.values(this.peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");

      sender?.replaceTrack(videoTrack);
    });

    // notify others via signaling
    this.send({
      type: "SCREEN_SHARE_START",
      sender: this.myId,
      room_id: this.roomId,
    });

    return this.screenStream;
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());

    this.screenStream = null;
    this.isScreenSharing = false;

    // restore camera
    const cameraTrack = this.localStream?.getVideoTracks()[0];

    Object.values(this.peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");

      if (cameraTrack) {
        sender?.replaceTrack(cameraTrack);
      }
    });

    this.send({
      type: "SCREEN_SHARE_STOP",
      sender: this.myId,
      room_id: this.roomId,
    });
  }

  sendChatMessage(payload: ChatInput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not connected");
      return;
    }

    if (!this.roomId) {
      console.warn("No roomId set");
      return;
    }

    const isPrivate = !!payload?.target;

    const senderName = this.state.localParticipant?.name || "Anonymous";

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender_id: this.myId,
      sender_name: senderName,
      text: payload.message.trim(),
      timestamp: Date.now(),
      reply_to: payload.reply_to ?? null,
      target: isPrivate ? (payload?.reply_to?.id ?? null) : null,
    };

    // optimistic UI update
    this.state.addChatMessage(msg);

    // send protocol payload (clean + consistent)
    this.send({
      type: "CHAT_MESSAGE",
      message: payload.message.trim(),
      user_id: this.myId,
      sender_name: senderName,
      room_id: this.roomId,
      target: isPrivate ? (payload.target ?? null) : null,
      reply_to: payload.reply_to ?? null,

      client_ts: Date.now(),
    });
  }

  disconnect() {
    // Close all peer connections
    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.initiators.clear();

    this.stopHeartbeat();
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Stop local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Reset state
    this.roomId = null;
    this.state.participants.clear();
    this.state.streams.clear();
    this.state.clearChat();
  }

  // ---------------- SEND ----------------
  private send(msg: any) {
    this.ws?.send(JSON.stringify(msg));
  }
}
