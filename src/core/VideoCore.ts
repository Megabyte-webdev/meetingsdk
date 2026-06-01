import { MeetingState, Participant } from "./MeetingState";

type Events = {
  onTrack?: (stream: MediaStream, peerId: string) => void;
  onUserJoined?: (p: Participant) => void;
  onUserLeft?: (id: string) => void;
};

export class VideoSDKCore {
  private ws: WebSocket | null = null;
  private peers: Record<string, RTCPeerConnection> = {};
  private initiators = new Set<string>();

  private myId: string;
  private roomId: string | null = null;
  private localStream: MediaStream | null = null;

  constructor(
    private url: string,
    private state: MeetingState,
    private events: Events = {},
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
    };

    this.state.localStream = this.localStream;
  }

  // ---------------- CONNECT ----------------
  async connect(roomId: string, name: string) {
    this.roomId = roomId;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name,
        });

        resolve();
      };

      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };

      this.ws.onerror = reject;
    });
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
        this.closePeer(msg.peerId);

        this.state.removeParticipant(msg.peerId);

        this.events.onUserLeft?.(msg.peerId);

        break;
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

  disconnect() {
    // Close all peer connections
    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.initiators.clear();

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
  }

  // ---------------- SEND ----------------
  private send(msg: any) {
    this.ws?.send(JSON.stringify(msg));
  }
}
