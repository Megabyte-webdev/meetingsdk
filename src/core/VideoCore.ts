import { SDK_CONFIG } from "../config/ws";
import {
  ChatInput,
  ChatMessage,
  Events,
  MeetingConfig,
  SDKError,
} from "../types/meeting";
import { MeetingState } from "./MeetingState";

export class VideoSDKCore {
  private ws: WebSocket | null = null;
  private peers: Record<string, RTCPeerConnection> = {};
  private initiators = new Set<string>();
  private lastPong = Date.now();
  private iceServers: RTCIceServer[] = [];
  private intentionalDisconnect = false;

  private myId: string;
  private room: { id: string | null; name: string | null } = {
    id: null,
    name: null,
  };
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private isScreenSharing = false;
  private screenSenders: Record<string, RTCRtpSender[]> = {};

  private pingInterval: any = null;
  private pendingIceCandidates: Record<string, RTCIceCandidateInit[]> = {};
  private reconnectAttempts = 0;
  private reconnectTimer?: number;
  private participantName = "";
  public readonly state: MeetingState;
  private joinResolver?: () => void;
  private joinRejecter?: (e: any) => void;
  private emitError(
    code: string,
    message: string,
    raw?: any,
    recoverable = true,
  ) {
    const err: SDKError = {
      code,
      message,
      raw,
      roomId: this.room.id,
      userId: this.myId,
      recoverable,
    };

    this.events.onError?.(err);

    this.joinRejecter?.(err);
    this.joinRejecter = undefined;

    console.error("[MeetingSDK Error]", err);
  }

  constructor(
    private events: Events = {},
    private url: string = SDK_CONFIG.wsUrl,
  ) {
    this.state = new MeetingState();
    this.events = events;
    this.url = url;

    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();

    localStorage.setItem("vsdk_id", this.myId);
  }

  // ---------------- STREAM ----------------
  async initLocal(video: HTMLVideoElement, name: string) {
    this.participantName = name;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Verify tracks are actually live BEFORE connecting
      const hasVideo = this.localStream
        .getVideoTracks()
        .some((t) => t.readyState === "live");
      const hasAudio = this.localStream
        .getAudioTracks()
        .some((t) => t.readyState === "live");

      if (!hasVideo || !hasAudio) {
        throw new Error(`Missing tracks: video=${hasVideo}, audio=${hasAudio}`);
      }

      video.srcObject = this.localStream;
      this.state.updateLocalParticipant({
        id: this.myId,
        name: this.participantName,
        media: {
          stream: this.localStream,
          micEnabled: true,
          camEnabled: true,
          isScreenSharing: false,
        },
      });

      this.state.localStream = this.localStream;
    } catch (err: any) {
      this.emitError("GET_USER_MEDIA_FAILED", err?.message, err, false);
      throw err;
    }
  }

  // ---------------- CONNECT ----------------
  async connect(roomId: string, name: string) {
    this.room.id = roomId;

    this.reset();

    return new Promise<void>((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name,
        });
      };

      this.ws.onerror = (err) => {
        this.emitError("WS_ERROR", "WebSocket encountered an error", err, true);
      };

      this.ws.onclose = (e) => {
        this.joinRejecter?.({
          code: "WS_CLOSED",
          message: "Connection closed before join completed",
          raw: e,
        });

        this.joinRejecter = undefined;

        if (this.intentionalDisconnect) {
          return; // do NOT reconnect
        }

        if (e.code === 1000 || e.code === 1001) {
          return;
        }

        this.scheduleReconnect();
      };

      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };
    });
  }

  async joinMeeting(config: MeetingConfig) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;

    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }

    this.participantName = name;

    // Reuse existing stream if initLocal already configured it
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    }

    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = !audioMuted;
    });
    this.localStream.getVideoTracks().forEach((t) => {
      t.enabled = !videoMuted;
    });

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        stream: this.localStream,
        micEnabled: !audioMuted,
        camEnabled: !videoMuted,
        isScreenSharing: false,
      },
    });

    this.state.localStream = this.localStream;

    await this.connect(roomId, name);
  }

  /** Expose the roomId without making it fully public */
  getMeeting(): { id: string | null; name: string | null } {
    return this.room;
  }

  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.micEnabled;

    this.localStream
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = nextEnabled));

    // Update state layer
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        micEnabled: nextEnabled,
      },
    });

    // Notify peers
    this.send({
      type: "MEDIA_STATE",
      kind: "audio",
      enabled: nextEnabled,
    });
  }

  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.camEnabled;

    this.localStream
      ?.getVideoTracks()
      .forEach((t) => (t.enabled = nextEnabled));

    // Update state layer
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        camEnabled: nextEnabled,
      },
    });

    // Notify peers
    this.send({
      type: "MEDIA_STATE",
      kind: "video",
      enabled: nextEnabled,
    });
  }

  private scheduleReconnect() {
    if (!this.room.id) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    clearTimeout(this.reconnectTimer);

    this.reconnectTimer = window.setTimeout(async () => {
      try {
        await this.connect(this.room.id!, this.participantName);

        this.reconnectAttempts = 0;
      } catch {
        this.reconnectAttempts++;
        this.scheduleReconnect();
      }
    }, delay);
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
    this.initiators.clear();
    this.pendingIceCandidates = {};

    this.state.resetRemoteState();
  }

  // ---------------- HANDLE SIGNALS ----------------
  private async handle(msg: any) {
    if (msg.sender === this.myId) return;

    switch (msg.type) {
      case "PONG":
        this.lastPong = Date.now();
        break;
      case "OFFER":
        console.log("[Offer] Received from", msg.sender, {
          sdp: msg.payload.substring(0, 200),
        });
        await this.handleOffer(msg.payload, msg.sender);
        break;

      case "ANSWER": {
        const pc = this.peers[msg.sender];
        console.log("[Answer] Received from", msg.sender, {
          signalingState: pc?.signalingState,
          iceConnectionState: pc?.iceConnectionState,
          connectionState: pc?.connectionState,
        });

        if (!pc) return;

        if (pc.signalingState !== "have-local-offer") {
          console.warn(
            `[Signaling] Unexpected ANSWER in state "${pc.signalingState}", ignoring`,
          );
          return;
        }

        try {
          await pc.setRemoteDescription({
            type: "answer",
            sdp: msg.payload,
          });

          await this.flushIce(msg.sender, pc);
        } catch (err) {
          console.error("[Signaling] Failed to apply answer:", err);
          this.emitError(
            "ANSWER_FAILED",
            `Failed to apply answer from ${msg.sender}`,
            err,
            true,
          );
        }
        break;
      }
      case "ICE": {
        const candidate = JSON.parse(msg.payload);

        let pc = this.peers[msg.sender];

        if (!pc) {
          this.pendingIceCandidates[msg.sender] ??= [];
          this.pendingIceCandidates[msg.sender].push(candidate);
          break;
        }

        if (!pc.remoteDescription) {
          this.pendingIceCandidates[msg.sender] ??= [];
          this.pendingIceCandidates[msg.sender].push(candidate);
          break;
        }

        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.warn("ICE error:", err);
        }

        break;
      }
      case "EXISTING_USERS":
        if (msg.presenterId) {
          this.state.setPresenterId(msg.presenterId);

          // Trigger your event so the UI knows to render the stage
          this.events.onScreenShareStarted?.(msg.presenterId, null!);
        }

        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;
          this.state.addParticipant(p);
          this.events.onUserJoined?.(p);
          if (this.shouldInitiate(p.id)) {
            await this.createOffer(p.id);
          }
        }
        break;

      case "JOINED": {
        if (msg.iceServers) {
          this.iceServers = msg.iceServers;
        }
        this.room.name = msg.room_name;

        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = undefined;
        this.joinRejecter = undefined;
        break;
      }
      case "USER_JOINED": {
        const p = msg.participant;

        if (!p?.id || p.id === this.myId) return;

        this.state.addParticipant(p);

        this.events.onUserJoined?.(p);
        if (this.shouldInitiate(p.id)) {
          await this.createOffer(p.id);
        }

        break;
      }

      case "USER_LEFT":
        const peerId = msg.participant.id;
        this.closePeer(peerId);

        this.state.removeParticipant(peerId);

        this.events.onUserLeft?.(peerId);

        break;

      case "MEDIA_STATE_CHANGE": {
        const peerId = msg.peerId;
        const { kind, enabled } = msg;

        // 1. Sync the app state layer for UI rendering components
        if (kind === "audio") {
          this.state.updateParticipantMedia(peerId, { micEnabled: enabled });
          this.events.onMicToggled?.(peerId, enabled);
        } else if (kind === "video") {
          this.state.updateParticipantMedia(peerId, { camEnabled: enabled });
          this.events.onCamToggled?.(peerId, enabled);
        }

        break;
      }

      case "CHAT_MESSAGE": {
        const newMsg = msg.data;

        if (newMsg.sender_id === this.myId) break; // already added optimistically
        this.state.addChatMessage({
          id: newMsg.id,
          text: newMsg.message,
          sender_id: newMsg.sender_id,
          sender_name: newMsg.sender_name,
          timestamp: new Date(newMsg.timestamp).getTime(),
          target: newMsg.target,
        });

        this.events.onChatMessage?.(msg);
        break;
      }
      case "SCREEN_SHARE_START": {
        const peerId = msg.peerId;

        this.state.updateParticipantMedia(peerId, {
          isScreenSharing: true,
          remoteScreenStreamId: msg.stream_id,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(peerId);
        }

        // Fix: Use screenStream instead of the regular camera stream
        const screenStream =
          this.state.getParticipant(peerId)?.media?.screenStream;

        this.events.onScreenShareStarted?.(peerId, screenStream || null!);
        break;
      }

      case "SCREEN_SHARE_STOP": {
        const peerId = msg.peerId;
        this.state.updateParticipantMedia(peerId, { isScreenSharing: false });
        if (this.state.presenterId === peerId) {
          this.state.setPresenterId(null);
        }
        this.events.onScreenShareStopped?.(peerId);
        break;
      }
      case "ERROR": {
        const fatal = msg?.fatal === true;

        this.emitError(
          "WS_ERROR",
          msg?.message || "Unknown error",
          msg,
          !fatal,
        );

        if (fatal) {
          this.disconnect();
        }

        return;
      }
    }
  }

  // ---------------- PEER ----------------
  private createPeer(id: string) {
    if (!this.localStream) throw new Error("No local stream");
    if (!this.iceServers || this.iceServers.length === 0) {
      throw new Error(
        "ICE Servers not configured. Backend must provide iceServers on JOIN.",
      );
    }

    console.log(
      "Adding tracks",
      this.localStream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        state: t.readyState,
      })),
    );

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    pc.ontrack = (event) => {
      const incomingStream =
        event.streams?.[0] || new MediaStream([event.track]);
      const participant = this.state.getParticipant(id);

      const isScreenStream =
        incomingStream.id === participant?.media?.remoteScreenStreamId;

      // Handle track unmuting (happens after RTP data starts flowing)
      if (event.track.muted) {
        event.track.onunmute = () => {
          console.log(`${event.track.kind} track unmuted for ${id}`);
        };
      }

      if (isScreenStream) {
        const videoTrack =
          event.track.kind === "video"
            ? event.track
            : incomingStream.getVideoTracks()[0] ||
              participant?.media?.screenTrack;

        this.state.updateParticipantMedia(id, {
          screenStream: incomingStream,
          screenTrack: videoTrack,

          isScreenSharing: true,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(id);
        }

        this.events.onScreenShareStarted?.(id, incomingStream);
      } else {
        this.state.updateParticipantMedia(id, {
          stream: incomingStream,
          cameraTrack: incomingStream.getVideoTracks()[0],
          audioTrack: incomingStream.getAudioTracks()[0],
        });
        this.events.onTrack?.(incomingStream, id);
      }
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

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE Connection State: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch {}
      }
    };

    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!);
    });

    if (this.isScreenSharing && this.screenStream) {
      this.screenSenders[id] = [];
      this.screenStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, this.screenStream!);
        this.screenSenders[id].push(sender);
      });
    }

    return pc;
  }

  // ---------------- OFFER ----------------
  private async createOffer(id: string, isRenegotiation = false) {
    if (!isRenegotiation && !this.shouldInitiate(id)) {
      console.debug(
        `[Offer] ${id} should initiate (${id} > ${this.myId}), skipping`,
      );
      return; // ← Actually return!
    }

    if (!isRenegotiation && this.initiators.has(id)) {
      console.debug(
        `[Offer] Already initiating with ${id}, skipping duplicate`,
      );
      return; // ← This was missing!
    }

    if (!isRenegotiation) {
      this.initiators.add(id);
    }
    if (!this.peers[id]) {
      this.peers[id] = this.createPeer(id);
    }

    const pc = this.peers[id];

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.send({
        type: "OFFER",
        payload: offer.sdp,
        sender: this.myId,
        target: id,
      });

      console.debug(`[Offer] Sent to ${id}`);
    } catch (err) {
      console.error(`[Offer] Failed for ${id}:`, err);
    }
  }

  private shouldInitiate(peerId: string): boolean {
    // Lexicographic comparison: lower ID initiates
    return this.myId < peerId;
  }

  // ---------------- ANSWER ----------------
  private async handleOffer(sdp: string, id: string) {
    if (!this.peers[id]) {
      this.peers[id] = this.createPeer(id);
    }

    const pc = this.peers[id];

    try {
      // GLARE RECOVERY: Both peers sent OFFERs simultaneously
      if (pc.signalingState === "have-local-offer") {
        if (this.shouldInitiate(id)) {
          // WE WIN: Keep our offer, reject theirs
          console.warn(
            `[Glare] Both sent OFFERs, we win (${this.myId} < ${id}), keeping our OFFER`,
          );
          return; // ← Ignore their offer, wait for their ANSWER
        } else {
          // THEY WIN: Roll back and accept their offer
          console.warn(
            `[Glare] Both sent OFFERs, they win (${id} < ${this.myId}), rolling back`,
          );
          pc.close();
          delete this.peers[id];
          this.initiators.delete(id);

          // Create fresh peer connection to answer their offer
          this.peers[id] = this.createPeer(id);
        }
      }

      // Only set remote description if we're not already in negotiation
      if (
        this.peers[id].signalingState !== "stable" &&
        this.peers[id].signalingState !== "have-local-offer"
      ) {
        console.warn(
          `[Signaling] Cannot accept OFFER in state "${this.peers[id].signalingState}"`,
        );
        return;
      }

      await this.peers[id].setRemoteDescription({
        type: "offer",
        sdp,
      });

      const pending = this.pendingIceCandidates[id] || [];

      for (const candidate of pending) {
        try {
          await this.peers[id].addIceCandidate(candidate);
        } catch (err) {
          console.warn("[ICE] Failed to add candidate:", err);
        }
      }

      delete this.pendingIceCandidates[id];

      const answer = await this.peers[id].createAnswer();

      await this.peers[id].setLocalDescription(answer);
      await this.flushIce(id, this.peers[id]);

      this.send({
        type: "ANSWER",
        payload: answer.sdp,
        sender: this.myId,
        target: id,
      });

      console.debug(`[Answer] Sent to ${id}`);
    } catch (err) {
      console.error(`[Signaling] Failed to handle OFFER from ${id}:`, err);
      this.emitError(
        "OFFER_HANDLING_FAILED",
        `Failed to handle offer from ${id}`,
        err,
        true,
      );
    }
  }

  // ---------------- CLEANUP ----------------
  private closePeer(id: string) {
    const pc = this.peers[id];

    if (!pc) return;

    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;

    pc.close();

    delete this.peers[id];

    this.initiators.delete(id);

    this.state.removeParticipant(id);
  }

  async startScreenShare() {
    try {
      if (this.state.presenterId && this.state.presenterId !== this.myId) {
        throw new Error("Another user is already sharing their screen.");
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing not supported on this device");
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        // audio: true,
      });

      this.isScreenSharing = true;

      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack: this.screenStream.getVideoTracks()[0],
        },
      });

      this.state.setPresenterId(this.myId);
      // Handle the user clicking browser's built-in "Stop Sharing" button
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      Object.entries(this.peers).forEach(([peerId, pc]) => {
        this.screenSenders[peerId] = [];
        this.screenStream!.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, this.screenStream!);
          this.screenSenders[peerId].push(sender);
        });

        // Renegotiate peer connection descriptors to notify remote side of new track footprint
        this.createOffer(peerId, true);
      });

      this.send({
        type: "SCREEN_SHARE_START",
        sender: this.myId,
        room_id: this.room.id,
        stream_id: this.screenStream.id.replace(/[{}]/g, ""),
      });

      return this.screenStream;
    } catch (err: any) {
      this.emitError(
        "SCREEN_SHARE_FAILED",
        err?.message || "Failed to start screen sharing",
        err,
        true,
      );

      this.isScreenSharing = false;
      this.screenStream = null;
      throw err;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());

    // Remove tracks cleanly from WebRTC channel pathways across your peers
    Object.entries(this.peers).forEach(([peerId, pc]) => {
      const senders = this.screenSenders[peerId] || [];
      senders.forEach((sender) => {
        try {
          pc.removeTrack(sender);
        } catch (err) {
          console.warn(err);
        }
      });
      delete this.screenSenders[peerId];

      // Renegotiate layout expectations to scale down stream bounds
      this.createOffer(peerId, true);
    });

    this.screenStream = null;
    this.isScreenSharing = false;

    this.state.updateLocalParticipant({
      media: {
        isScreenSharing: false,
        screenStream: null,
        screenTrack: undefined,
      },
    });

    if (this.state.presenterId === this.myId) {
      this.state.setPresenterId(null);
    }

    this.send({
      type: "SCREEN_SHARE_STOP",
      sender: this.myId,
      room_id: this.room.id,
    });
  }

  sendChatMessage(payload: ChatInput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not connected");
      return;
    }

    if (!this.room.id) {
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
      target: payload.target ?? null,
    };

    // optimistic UI update
    this.state.addChatMessage(msg);

    // send protocol payload (clean + consistent)
    this.send({
      type: "CHAT_MESSAGE",
      message: payload.message.trim(),
      user_id: this.myId,
      sender_name: senderName,
      room_id: this.room.id,
      target: isPrivate ? (payload.target ?? null) : null,
      reply_to: payload.reply_to ?? null,

      client_ts: Date.now(),
    });
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.stopScreenShare();

    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.initiators.clear();

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.room.id = null;

    // Clear and notify
    this.state.localParticipant = null;
    this.state.notify("localParticipant");

    this.state.participants.clear();
    this.state.notify("participants");

    this.state.clearChat();
    this.state.setPresenterId(null);
  }

  private async flushIce(id: string, pc: RTCPeerConnection) {
    const pending = this.pendingIceCandidates[id];
    if (!pending?.length) return;

    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn("ICE flush error", e);
      }
    }

    delete this.pendingIceCandidates[id];
  }

  private send(msg: any) {
    this.ws?.send(JSON.stringify(msg));
  }
}
