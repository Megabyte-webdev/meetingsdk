"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  MeetingProvider: () => MeetingProvider,
  MeetingState: () => MeetingState,
  VideoSDKCore: () => VideoSDKCore,
  useLocalParticipant: () => useLocalParticipant,
  useMeeting: () => useMeeting,
  useMeetingContext: () => useMeetingContext,
  useParticipants: () => useParticipants,
  useRemoteMedia: () => useRemoteMedia
});
module.exports = __toCommonJS(index_exports);

// src/react/useLocalParticipant.tsx
var import_react3 = require("react");

// src/react/MeetingProvider.tsx
var import_react2 = require("react");

// src/config/ws.ts
var SDK_CONFIG = {
  wsUrl: "wss://rust-video-server-sfyf.onrender.com/ws"
};

// src/core/MeetingState.ts
var MeetingState = class {
  constructor() {
    this.participants = /* @__PURE__ */ new Map();
    this.localParticipant = null;
    this.localStream = null;
    this.chatMessages = /* @__PURE__ */ new Map();
    this.presenterId = null;
    this.listeners = /* @__PURE__ */ new Map();
  }
  // ---- reactive system ----
  subscribe(scope, fn) {
    if (!this.listeners.has(scope)) {
      this.listeners.set(scope, /* @__PURE__ */ new Set());
    }
    this.listeners.get(scope).add(fn);
    return () => {
      this.listeners.get(scope)?.delete(fn);
    };
  }
  notify(scope) {
    this.listeners.get(scope)?.forEach((fn) => fn());
  }
  setPresenterId(id) {
    if (this.presenterId === id) return;
    this.presenterId = id;
    this.notify("presenter");
    this.notify("participants");
  }
  // ---- participants ----
  addParticipant(p) {
    if (this.participants.has(p.id)) return false;
    const next = new Map(this.participants);
    next.set(p.id, p);
    this.participants = next;
    this.notify("participants");
    return true;
  }
  removeParticipant(id) {
    const next = new Map(this.participants);
    next.delete(id);
    this.participants = next;
    this.notify("participants");
  }
  updateParticipantMedia(id, patch) {
    const p = this.participants.get(id);
    if (!p) return;
    const updated = {
      ...p,
      media: {
        stream: null,
        screenStream: void 0,
        cameraTrack: void 0,
        screenTrack: void 0,
        audioTrack: void 0,
        micEnabled: true,
        camEnabled: true,
        isScreenSharing: false,
        ...p.media,
        // preserve existing media items if they happen to exist
        ...patch
        // apply the incoming stream updates
      }
    };
    const next = new Map(this.participants);
    next.set(id, updated);
    this.participants = next;
    this.notify(`participant:${id}`);
    this.notify("participants");
  }
  updateLocalParticipant(patch) {
    const prev = this.localParticipant;
    if (!prev) {
      this.localParticipant = {
        id: patch.id ?? "",
        name: patch.name ?? "",
        media: {
          stream: patch.media?.stream ?? null,
          // ◄ FIX: Capture the stream from the patch here
          screenStream: patch.media?.screenStream,
          cameraTrack: patch.media?.cameraTrack,
          screenTrack: patch.media?.screenTrack,
          audioTrack: patch.media?.audioTrack,
          micEnabled: patch.media?.micEnabled ?? true,
          camEnabled: patch.media?.camEnabled ?? true,
          isScreenSharing: patch.media?.isScreenSharing ?? false
        }
      };
      this.notify("localParticipant");
      return;
    }
    const prevMedia = prev.media ?? {
      stream: null,
      screenStream: void 0,
      cameraTrack: void 0,
      screenTrack: void 0,
      audioTrack: void 0,
      micEnabled: true,
      camEnabled: true,
      isScreenSharing: false
    };
    const nextMedia = {
      stream: patch.media?.stream ?? prevMedia.stream,
      screenStream: patch.media?.screenStream ?? prevMedia.screenStream,
      cameraTrack: patch.media?.cameraTrack ?? prevMedia.cameraTrack,
      screenTrack: patch.media?.screenTrack ?? prevMedia.screenTrack,
      audioTrack: patch.media?.audioTrack ?? prevMedia.audioTrack,
      micEnabled: patch.media?.micEnabled ?? prevMedia.micEnabled,
      camEnabled: patch.media?.camEnabled ?? prevMedia.camEnabled,
      isScreenSharing: patch.media?.isScreenSharing ?? prevMedia.isScreenSharing
    };
    this.localParticipant = {
      ...prev,
      id: patch.id ?? prev.id,
      name: patch.name ?? prev.name,
      media: nextMedia
    };
    this.notify("localParticipant");
  }
  // ---- chat ----
  addChatMessage(msg) {
    this.chatMessages.set(msg.id, msg);
    this.notify("chat");
  }
  getChatMessages() {
    return Array.from(this.chatMessages.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }
  clearChat() {
    this.chatMessages.clear();
    this.notify("chat");
  }
  // ---- helpers ----
  getParticipants() {
    return Array.from(this.participants.values());
  }
  getParticipant(id) {
    return this.participants.get(id) ?? null;
  }
  resetRemoteState() {
    this.participants.clear();
    this.chatMessages.clear();
    this.presenterId = null;
    this.notify("participants");
    this.notify("chat");
    this.notify("presenter");
  }
};

// src/core/VideoCore.ts
var VideoSDKCore = class {
  constructor(events = {}, url = SDK_CONFIG.wsUrl) {
    this.events = events;
    this.url = url;
    this.ws = null;
    this.peers = {};
    this.initiators = /* @__PURE__ */ new Set();
    this.lastPong = Date.now();
    this.iceServers = [];
    this.intentionalDisconnect = false;
    this.room = {
      id: null,
      name: null
    };
    this.localStream = null;
    this.screenStream = null;
    this.isScreenSharing = false;
    // Transceiver-based tracking: maps peerId -> { cameraTransceiver, screenTransceiver, screenMid }
    this.peerTransceivers = {};
    this.pingInterval = null;
    this.pendingIceCandidates = {};
    this.pendingOffers = {};
    this.reconnectAttempts = 0;
    this.participantName = "";
    // Track if we're in the waiting room (pending approval)
    this.isWaitingForApproval = false;
    this.pendingRequestId = null;
    this.state = new MeetingState();
    this.events = events;
    this.url = url;
    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();
    localStorage.setItem("vsdk_id", this.myId);
  }
  emitError(code, message, raw, recoverable = true) {
    const err = {
      code,
      message,
      raw,
      roomId: this.room.id,
      userId: this.myId,
      recoverable
    };
    this.events.onError?.(err);
    this.joinRejecter?.(err);
    this.joinRejecter = void 0;
    console.error("[MeetingSDK Error]", err);
  }
  // STREAM
  async initLocal(video, name) {
    this.participantName = name;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const hasVideo = this.localStream.getVideoTracks().some((t) => t.readyState === "live");
      const hasAudio = this.localStream.getAudioTracks().some((t) => t.readyState === "live");
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
          isScreenSharing: false
        }
      });
      this.state.localStream = this.localStream;
    } catch (err) {
      this.emitError("GET_USER_MEDIA_FAILED", err?.message, err, false);
      throw err;
    }
  }
  // CONNECT
  async connect(roomId, name) {
    this.room.id = roomId;
    this.reset();
    return new Promise((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        console.log("WebSocket connected, sending JOIN...");
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name
        });
      };
      this.ws.onerror = (err) => {
        this.emitError("WS_ERROR", "WebSocket encountered an error", err, true);
      };
      this.ws.onclose = (e) => {
        this.joinRejecter?.({
          code: "WS_CLOSED",
          message: "Connection closed before join completed",
          raw: e
        });
        this.joinRejecter = void 0;
        if (this.intentionalDisconnect) {
          return;
        }
        if (e.code === 1e3 || e.code === 1001) {
          return;
        }
        if (this.isWaitingForApproval) {
          console.log("Waiting for approval, not auto-reconnecting");
          return;
        }
        this.scheduleReconnect();
      };
      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };
    });
  }
  async joinMeeting(config) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;
    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }
    this.participantName = name;
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
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
        isScreenSharing: false
      }
    });
    this.state.localStream = this.localStream;
    await this.connect(roomId, name);
  }
  getMeeting() {
    return this.room;
  }
  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;
    const nextEnabled = !mediaState.micEnabled;
    this.localStream?.getAudioTracks().forEach((t) => t.enabled = nextEnabled);
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        micEnabled: nextEnabled
      }
    });
    this.send({
      type: "MEDIA_STATE",
      kind: "audio",
      enabled: nextEnabled
    });
  }
  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;
    const nextEnabled = !mediaState.camEnabled;
    this.localStream?.getVideoTracks().forEach((t) => t.enabled = nextEnabled);
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        camEnabled: nextEnabled
      }
    });
    this.send({
      type: "MEDIA_STATE",
      kind: "video",
      enabled: nextEnabled
    });
  }
  scheduleReconnect() {
    if (!this.room.id) return;
    const delay = Math.min(1e3 * Math.pow(2, this.reconnectAttempts), 3e4);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(async () => {
      try {
        await this.connect(this.room.id, this.participantName);
        this.reconnectAttempts = 0;
      } catch {
        this.reconnectAttempts++;
        this.scheduleReconnect();
      }
    }, delay);
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.send({
        type: "PING",
        client_ts: Date.now()
      });
    }, 2e4);
  }
  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  // RESET
  reset() {
    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.peerTransceivers = {};
    this.initiators.clear();
    this.pendingIceCandidates = {};
    this.state.resetRemoteState();
  }
  async handleJoinApproved(msg) {
    console.log("JOIN_APPROVED received, sending new JOIN...");
    this.events.onEntryResponded?.({
      participantId: msg.user_id,
      decision: "approved"
    });
    this.isWaitingForApproval = false;
    this.pendingRequestId = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: "JOIN",
        room_id: this.room.id,
        user_id: this.myId,
        sender_name: this.participantName
      });
      console.log("Sent new JOIN after approval");
    }
  }
  async handle(msg) {
    var _a, _b, _c, _d;
    if (msg.sender === this.myId) return;
    switch (msg.type) {
      case "PONG":
        this.lastPong = Date.now();
        break;
      case "OFFER":
        console.log("[Offer] Received from", msg.sender, {
          sdp: msg.payload.substring(0, 200)
        });
        await this.handleOffer(msg.payload, msg.sender);
        break;
      case "ANSWER": {
        const pc = this.peers[msg.sender];
        console.log("[Answer] Received from", msg.sender, {
          signalingState: pc?.signalingState,
          iceConnectionState: pc?.iceConnectionState,
          connectionState: pc?.connectionState
        });
        if (!pc) return;
        if (pc.signalingState !== "have-local-offer") {
          console.warn(
            `[Signaling] Unexpected ANSWER in state "${pc.signalingState}", ignoring`
          );
          return;
        }
        try {
          await pc.setRemoteDescription({
            type: "answer",
            sdp: msg.payload
          });
          this.captureScreenMid(msg.sender);
          await this.flushIce(msg.sender, pc);
        } catch (err) {
          console.error("[Signaling] Failed to apply answer:", err);
          this.emitError(
            "ANSWER_FAILED",
            `Failed to apply answer from ${msg.sender}`,
            err,
            true
          );
        }
        break;
      }
      case "ICE": {
        const candidate = JSON.parse(msg.payload);
        let pc = this.peers[msg.sender];
        if (!pc) {
          (_a = this.pendingIceCandidates)[_b = msg.sender] ?? (_a[_b] = []);
          this.pendingIceCandidates[msg.sender].push(candidate);
          break;
        }
        if (!pc.remoteDescription) {
          (_c = this.pendingIceCandidates)[_d = msg.sender] ?? (_c[_d] = []);
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
          this.events.onScreenShareStarted?.(msg.presenterId, null);
        }
        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;
          this.state.addParticipant(p);
          this.events.onUserJoined?.(p);
          if (p.isScreenSharing && p.remoteScreenStreamId) {
            console.log(
              `[Existing Users] ${p.name} is sharing screen (stream: ${p.remoteScreenStreamId})`
            );
            this.state.setPresenterId(p.id);
            this.state.updateParticipantMedia(p.id, {
              isScreenSharing: true,
              remoteScreenStreamId: p.remoteScreenStreamId
            });
            console.log(
              `[EXISTING_USERS] Pre-seeded screen state for ${p.id}, waiting for ontrack`
            );
          }
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
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        if (Object.keys(this.pendingOffers).length > 0) {
          console.log(
            "Processing",
            Object.keys(this.pendingOffers).length,
            "pending offers"
          );
          for (const [peerId2, sdp] of Object.entries(this.pendingOffers)) {
            console.log("Handling queued offer from", peerId2);
            await this.handleOffer(sdp, peerId2);
          }
          this.pendingOffers = {};
        }
        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = void 0;
        this.joinRejecter = void 0;
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
      case "JOIN_PENDING": {
        const req = msg.request;
        console.log("JOIN_PENDING - waiting for host approval");
        this.isWaitingForApproval = true;
        this.pendingRequestId = req.request_id;
        this.events.onEntryRequested?.({
          requestId: req.request_id,
          userId: req.user_id,
          name: req.name
        });
        break;
      }
      case "JOIN_REQUEST": {
        const req = msg.request;
        console.log("JOIN_REQUEST - show to host for approval");
        this.events.onEntryRequested?.({
          requestId: req.id,
          userId: req.user_id,
          name: req.name
        });
        break;
      }
      case "JOIN_APPROVED": {
        await this.handleJoinApproved(msg);
        break;
      }
      case "JOIN_REJECTED": {
        const decision = "rejected";
        console.log("JOIN_REJECTED - user not allowed to join");
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        this.events.onEntryResponded?.({
          participantId: msg.user_id,
          decision
        });
        break;
      }
      case "USER_LEFT":
        const peerId = msg.participant.id;
        this.closePeer(peerId);
        this.state.removeParticipant(peerId);
        this.events.onUserLeft?.(peerId);
        break;
      case "MEDIA_STATE_CHANGE": {
        const peerId2 = msg.peerId;
        const { kind, enabled } = msg;
        if (kind === "audio") {
          this.state.updateParticipantMedia(peerId2, { micEnabled: enabled });
          this.events.onMicToggled?.(peerId2, enabled);
        } else if (kind === "video") {
          this.state.updateParticipantMedia(peerId2, { camEnabled: enabled });
          this.events.onCamToggled?.(peerId2, enabled);
        }
        break;
      }
      case "CHAT_MESSAGE": {
        const newMsg = msg.data;
        if (newMsg.sender_id === this.myId) break;
        this.state.addChatMessage({
          id: newMsg.id,
          text: newMsg.message,
          sender_id: newMsg.sender_id,
          sender_name: newMsg.sender_name,
          timestamp: new Date(newMsg.timestamp).getTime(),
          target: newMsg.target
        });
        this.events.onChatMessage?.(msg);
        break;
      }
      case "SCREEN_SHARE_START": {
        const peerId2 = msg.peerId;
        this.state.updateParticipantMedia(peerId2, {
          isScreenSharing: true,
          remoteScreenStreamId: msg.stream_id
        });
        if (!this.state.presenterId) {
          this.state.setPresenterId(peerId2);
        }
        this.events.onScreenShareStarted?.(peerId2, null);
        break;
      }
      case "SCREEN_SHARE_STOP": {
        const peerId2 = msg.peerId;
        this.state.updateParticipantMedia(peerId2, { isScreenSharing: false });
        if (this.state.presenterId === peerId2) {
          this.state.setPresenterId(null);
        }
        this.events.onScreenShareStopped?.(peerId2);
        break;
      }
      case "ERROR": {
        const fatal = msg?.fatal === true;
        this.emitError(
          "WS_ERROR",
          msg?.message || "Unknown error",
          msg,
          !fatal
        );
        if (fatal) {
          this.disconnect();
        }
        return;
      }
    }
  }
  // PEER
  /**
   * Create a peer connection with pre-established transceiver layout:
   * - Audio transceiver (sendrecv)
   * - Camera video transceiver (sendrecv)
   * - Screen video transceiver (initially recvonly, becomes sendrecv when sharing)
   *
   * This fixed layout ensures late joiners get the screen transceiver m-line
   * negotiated from the very first offer, even if no one is sharing yet.
   */
  async createPeer(id) {
    if (!this.localStream) throw new Error("No local stream");
    if (!this.iceServers || this.iceServers.length === 0) {
      throw new Error(
        "ICE Servers not configured. Backend must provide iceServers on JOIN."
      );
    }
    console.log(
      "Creating peer connection for",
      id,
      "with tracks:",
      this.localStream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        state: t.readyState
      }))
    );
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });
    const audioTransceiver = pc.addTransceiver("audio", {
      direction: "sendrecv"
    });
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      await audioTransceiver.sender.replaceTrack(audioTrack);
    }
    const cameraTransceiver = pc.addTransceiver("video", {
      direction: "sendrecv"
    });
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      await cameraTransceiver.sender.replaceTrack(videoTrack);
    }
    const screenTransceiver = pc.addTransceiver("video", {
      direction: this.isScreenSharing ? "sendrecv" : "recvonly"
    });
    if (this.isScreenSharing && this.screenStream) {
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack) {
        await screenTransceiver.sender.replaceTrack(screenTrack);
      }
    }
    this.peerTransceivers[id] = {
      cameraTransceiver,
      screenTransceiver,
      screenMid: null
      // will be populated after negotiation
    };
    pc.ontrack = (event) => {
      const transceiver = event.transceiver;
      const isScreenTrack = transceiver.mid === this.peerTransceivers[id]?.screenMid;
      console.log(
        `[ontrack] ${id}: kind=${event.track.kind}, mid=${transceiver.mid}, isScreen=${isScreenTrack}`
      );
      const incomingStream = event.streams?.[0] || new MediaStream([event.track]);
      if (event.track.muted) {
        event.track.onunmute = () => {
          console.log(`[ontrack] ${event.track.kind} track unmuted for ${id}`);
        };
      }
      if (isScreenTrack) {
        const videoTrack2 = event.track.kind === "video" ? event.track : incomingStream.getVideoTracks()[0];
        this.state.updateParticipantMedia(id, {
          screenStream: incomingStream,
          screenTrack: videoTrack2,
          isScreenSharing: true
        });
        if (!this.state.presenterId) {
          this.state.setPresenterId(id);
        }
        this.events.onScreenShareStarted?.(id, incomingStream);
      } else {
        this.state.updateParticipantMedia(id, {
          stream: incomingStream,
          cameraTrack: incomingStream.getVideoTracks()[0],
          audioTrack: incomingStream.getAudioTracks()[0]
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
        target: id
      });
    };
    pc.oniceconnectionstatechange = () => {
      console.log(`[ICE Connection] ${id}: ${pc.iceConnectionState}`);
    };
    pc.onconnectionstatechange = () => {
      console.log(`[Connection] ${id}: ${pc.connectionState}`);
      if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch (e) {
          console.warn("Failed to restart ICE:", e);
        }
      }
    };
    return pc;
  }
  /**
   * Capture the screen transceiver's MID after SDP negotiation completes.
   * The MID is assigned during negotiation and is stable for the life of the connection.
   */
  captureScreenMid(peerId) {
    const pc = this.peers[peerId];
    if (!pc) return;
    const transceivers = pc.getTransceivers();
    const screenTransceiver = this.peerTransceivers[peerId]?.screenTransceiver;
    if (!screenTransceiver) return;
    const negotiatedTransceiver = transceivers.find(
      (t) => t === screenTransceiver
    );
    if (negotiatedTransceiver?.mid) {
      this.peerTransceivers[peerId].screenMid = negotiatedTransceiver.mid;
      console.log(
        `[Negotiation] Captured screenMid for ${peerId}: ${negotiatedTransceiver.mid}`
      );
    }
  }
  // OFFER
  async createOffer(id, isRenegotiation = false) {
    if (!isRenegotiation && !this.shouldInitiate(id)) {
      console.debug(
        `[Offer] ${id} should initiate (${id} > ${this.myId}), skipping`
      );
      return;
    }
    if (!isRenegotiation && this.initiators.has(id)) {
      console.debug(
        `[Offer] Already initiating with ${id}, skipping duplicate`
      );
      return;
    }
    if (!isRenegotiation) {
      this.initiators.add(id);
    }
    if (!this.peers[id]) {
      this.peers[id] = await this.createPeer(id);
    }
    const pc = this.peers[id];
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.captureScreenMid(id);
      this.send({
        type: "OFFER",
        payload: offer.sdp,
        sender: this.myId,
        target: id
      });
      console.debug(`[Offer] Sent to ${id}`);
    } catch (err) {
      console.error(`[Offer] Failed for ${id}:`, err);
      this.emitError(
        "OFFER_CREATION_FAILED",
        `Failed to create offer for ${id}`,
        err,
        true
      );
    }
  }
  shouldInitiate(peerId) {
    return this.myId < peerId;
  }
  // ANSWER
  async handleOffer(sdp, id) {
    if (!this.iceServers || this.iceServers.length === 0) {
      console.warn("[Offer] Waiting for iceServers, queuing offer from", id);
      this.pendingOffers[id] = sdp;
      return;
    }
    if (!this.peers[id]) {
      this.peers[id] = await this.createPeer(id);
    }
    const pc = this.peers[id];
    try {
      if (pc.signalingState === "have-local-offer") {
        if (this.shouldInitiate(id)) {
          console.warn(
            `[Glare] Both sent OFFERs, we win (${this.myId} < ${id}), keeping our OFFER`
          );
          return;
        } else {
          console.warn(
            `[Glare] Both sent OFFERs, they win (${id} < ${this.myId}), rolling back`
          );
          pc.close();
          delete this.peers[id];
          delete this.peerTransceivers[id];
          this.initiators.delete(id);
          this.peers[id] = await this.createPeer(id);
        }
      }
      if (this.peers[id].signalingState !== "stable" && this.peers[id].signalingState !== "have-local-offer") {
        console.warn(
          `[Signaling] Cannot accept OFFER in state "${this.peers[id].signalingState}"`
        );
        return;
      }
      await this.peers[id].setRemoteDescription({
        type: "offer",
        sdp
      });
      this.captureScreenMid(id);
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
        target: id
      });
      console.debug(`[Answer] Sent to ${id}`);
    } catch (err) {
      console.error(`[Signaling] Failed to handle OFFER from ${id}:`, err);
      this.emitError(
        "OFFER_HANDLING_FAILED",
        `Failed to handle offer from ${id}`,
        err,
        true
      );
    }
  }
  // CLEANUP
  closePeer(id) {
    const pc = this.peers[id];
    if (!pc) return;
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
    delete this.peers[id];
    delete this.peerTransceivers[id];
    this.initiators.delete(id);
    this.state.removeParticipant(id);
  }
  // SCREEN SHARE (TRANSCEIVER-BASED)
  /**
   * Start screen sharing using replaceTrack on the pre-established screen transceiver.
   * No need to add/remove tracks, no renegotiation needed (transceiver already in SDP).
   * Just swap the track and update direction if needed.
   */
  async startScreenShare() {
    try {
      if (this.state.presenterId && this.state.presenterId !== this.myId) {
        throw new Error("Another user is already sharing their screen.");
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing not supported on this device");
      }
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        throw new Error("No video track in screen stream");
      }
      this.isScreenSharing = true;
      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack
        }
      });
      this.state.setPresenterId(this.myId);
      screenTrack.onended = () => {
        console.log("[Screen Share] User stopped via browser button");
        this.stopScreenShare();
      };
      for (const [peerId, pc] of Object.entries(this.peers)) {
        const txInfo = this.peerTransceivers[peerId];
        if (!txInfo) {
          console.warn(
            `[Screen Share] No transceiver info for ${peerId}, skipping`
          );
          continue;
        }
        try {
          await txInfo.screenTransceiver.sender.replaceTrack(screenTrack);
          if (txInfo.screenTransceiver.currentDirection === "recvonly") {
            txInfo.screenTransceiver.direction = "sendrecv";
            console.log(
              `[Screen Share] Flipped ${peerId} screen transceiver to sendrecv`
            );
            await this.createOffer(peerId, true);
          }
        } catch (err) {
          console.error(
            `[Screen Share] Failed to update transceiver for ${peerId}:`,
            err
          );
        }
      }
      this.send({
        type: "SCREEN_SHARE_START",
        sender: this.myId,
        room_id: this.room.id,
        stream_id: this.screenStream.id.replace(/[{}]/g, "")
      });
      console.log("[Screen Share] Started successfully");
      return this.screenStream;
    } catch (err) {
      this.emitError(
        "SCREEN_SHARE_FAILED",
        err?.message || "Failed to start screen sharing",
        err,
        true
      );
      this.isScreenSharing = false;
      this.screenStream = null;
      throw err;
    }
  }
  async stopScreenShare() {
    if (!this.screenStream) return;
    console.log("[Screen Share] Stopping...");
    this.screenStream.getTracks().forEach((t) => t.stop());
    for (const [peerId, pc] of Object.entries(this.peers)) {
      const txInfo = this.peerTransceivers[peerId];
      if (!txInfo) continue;
      try {
        await txInfo.screenTransceiver.sender.replaceTrack(null);
        if (txInfo.screenTransceiver.currentDirection === "sendrecv") {
          txInfo.screenTransceiver.direction = "recvonly";
          console.log(
            `[Screen Share] Flipped ${peerId} screen transceiver to recvonly`
          );
          await this.createOffer(peerId, true);
        }
      } catch (err) {
        console.error(
          `[Screen Share] Failed to clear transceiver for ${peerId}:`,
          err
        );
      }
    }
    this.screenStream = null;
    this.isScreenSharing = false;
    this.state.updateLocalParticipant({
      media: {
        isScreenSharing: false,
        screenStream: null,
        screenTrack: void 0
      }
    });
    if (this.state.presenterId === this.myId) {
      this.state.setPresenterId(null);
    }
    this.send({
      type: "SCREEN_SHARE_STOP",
      sender: this.myId,
      room_id: this.room.id
    });
    console.log("[Screen Share] Stopped");
  }
  // CHAT
  sendChatMessage(payload) {
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
    const msg = {
      id: crypto.randomUUID(),
      sender_id: this.myId,
      sender_name: senderName,
      text: payload.message.trim(),
      timestamp: Date.now(),
      reply_to: payload.reply_to ?? null,
      target: payload.target ?? null
    };
    this.state.addChatMessage(msg);
    this.send({
      type: "CHAT_MESSAGE",
      message: payload.message.trim(),
      user_id: this.myId,
      sender_name: senderName,
      room_id: this.room.id,
      target: isPrivate ? payload.target ?? null : null,
      reply_to: payload.reply_to ?? null,
      client_ts: Date.now()
    });
  }
  // DISCONNECT
  disconnect() {
    this.intentionalDisconnect = true;
    this.stopScreenShare();
    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.peerTransceivers = {};
    this.initiators.clear();
    this.stopHeartbeat();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: "LEAVE",
        room_id: this.room.id,
        user_id: this.myId,
        sender_name: this.state.localParticipant?.name
      });
      setTimeout(() => {
        this.ws?.close(1e3, "Leaving meeting");
        this.ws = null;
      }, 50);
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.room.id = null;
    this.state.localParticipant = null;
    this.state.notify("localParticipant");
    this.state.participants.clear();
    this.state.notify("participants");
    this.events.onMeetingLeft?.();
    this.state.clearChat();
    this.state.setPresenterId(null);
  }
  async flushIce(id, pc) {
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
  send(msg) {
    this.ws?.send(JSON.stringify(msg));
  }
  approveJoinRequest(requestId) {
    this.send({
      type: "JOIN_APPROVE",
      request_id: requestId
    });
  }
  rejectJoinRequest(requestId) {
    this.send({
      type: "JOIN_REJECT",
      request_id: requestId
    });
  }
};

// src/react/useMeetingStore.ts
var import_react = require("react");
function useMeetingStore(stateManager, scope, selector) {
  const [state, setState] = (0, import_react.useState)(() => selector(stateManager));
  (0, import_react.useEffect)(() => {
    const unsubscribe = stateManager.subscribe(scope, () => {
      setState(selector(stateManager));
    });
    return unsubscribe;
  }, [stateManager, scope, selector]);
  return state;
}

// src/react/MeetingProvider.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var MeetingContext = (0, import_react2.createContext)(null);
var MeetingProvider = ({
  config,
  children
}) => {
  const sdkRef = (0, import_react2.useRef)(null);
  const errorListeners = (0, import_react2.useRef)(/* @__PURE__ */ new Set());
  const entryRequestListeners = (0, import_react2.useRef)(/* @__PURE__ */ new Set());
  const entryResponseListeners = (0, import_react2.useRef)(
    /* @__PURE__ */ new Set()
  );
  const meetingLeftListeners = (0, import_react2.useRef)(/* @__PURE__ */ new Set());
  if (!sdkRef.current) {
    sdkRef.current = new VideoSDKCore({
      onError: (err) => errorListeners.current.forEach((fn) => fn(err)),
      onEntryRequested: (req) => entryRequestListeners.current.forEach((fn) => fn(req)),
      onEntryResponded: (p, d) => entryResponseListeners.current.forEach((fn) => fn(p, d)),
      onMeetingLeft: () => meetingLeftListeners.current.forEach((fn) => fn())
    });
  }
  const sdk = sdkRef.current;
  const presenterId = useMeetingStore(
    sdk.state,
    "presenter",
    (s) => s.presenterId
  );
  const participants = useMeetingStore(
    sdk.state,
    "participants",
    (s) => s.participants
  );
  const localParticipant = useMeetingStore(
    sdk.state,
    "localParticipant",
    (s) => s.localParticipant
  );
  const messages = useMeetingStore(
    sdk.state,
    "chat",
    (s) => s.getChatMessages()
  );
  const value = (0, import_react2.useMemo)(() => {
    if (!sdkRef.current) {
      sdkRef.current = new VideoSDKCore({
        onError: (err) => {
          errorListeners.current.forEach((fn) => fn(err));
        }
      });
    }
    return {
      sdk,
      join: (joinConfig) => sdk.joinMeeting({
        ...config,
        ...joinConfig
      }),
      leave: () => sdk.disconnect(),
      toggleMic: sdk.toggleMic.bind(sdk),
      toggleCam: sdk.toggleCam.bind(sdk),
      startScreenShare: sdk.startScreenShare.bind(sdk),
      stopScreenShare: sdk.stopScreenShare.bind(sdk),
      sendMessage: sdk.sendChatMessage.bind(sdk),
      room: sdk.getMeeting(),
      localParticipant,
      participants,
      messages,
      presenterId,
      usePubSub: (topic) => {
        if (topic !== "SECURE_CHAT") {
          throw new Error(`Unsupported PubSub argument: "${topic}"`);
        }
        return {
          messages: sdk.state.getChatMessages(),
          publish: sdk.sendChatMessage.bind(sdk)
        };
      },
      approveJoinRequest: sdk.approveJoinRequest.bind(sdk),
      rejectJoinRequest: sdk.rejectJoinRequest.bind(sdk),
      onError: (cb) => {
        errorListeners.current.add(cb);
        return () => {
          errorListeners.current.delete(cb);
        };
      },
      onEntryRequested: (cb) => {
        entryRequestListeners.current.add(cb);
        return () => {
          entryRequestListeners.current.delete(cb);
        };
      },
      onEntryResponded: (cb) => {
        entryResponseListeners.current.add(cb);
        return () => {
          entryResponseListeners.current.delete(cb);
        };
      },
      onMeetingLeft: (cb) => {
        meetingLeftListeners.current.add(cb);
        return () => {
          meetingLeftListeners.current.delete(cb);
        };
      }
    };
  }, [config, sdk, localParticipant, participants, messages, presenterId]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MeetingContext.Provider, { value, children });
};
var useMeetingContext = () => {
  const ctx = (0, import_react2.useContext)(MeetingContext);
  if (!ctx)
    throw new Error("useMeetingContext must be used inside <MeetingProvider>");
  return ctx;
};

// src/react/useLocalParticipant.tsx
var useLocalParticipant = () => {
  const { sdk } = useMeetingContext();
  const [localParticipant, setLocalParticipant] = (0, import_react3.useState)(
    () => {
      const current = sdk.state.localParticipant;
      return current && current.id ? current : null;
    }
  );
  (0, import_react3.useEffect)(() => {
    const unsubscribe = sdk.state.subscribe("localParticipant", () => {
      const current = sdk.state.localParticipant;
      if (current && current.id) {
        setLocalParticipant({ ...current });
      } else {
        setLocalParticipant(null);
      }
    });
    return unsubscribe;
  }, [sdk]);
  const lastStreamRef = (0, import_react3.useRef)(null);
  const videoRef = (0, import_react3.useCallback)(
    (video) => {
      if (!video) return;
      const stream = localParticipant?.media?.stream;
      if (!stream) return;
      if (lastStreamRef.current === stream) return;
      lastStreamRef.current = stream;
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.play().catch((err) => {
        console.warn(`Autoplay failed for local view:`, err);
      });
    },
    [localParticipant?.media?.stream]
  );
  return {
    participant: localParticipant,
    videoRef
  };
};

// src/react/useMeeting.ts
var import_react4 = require("react");
var useMeeting = (handlers) => {
  const ctx = useMeetingContext();
  (0, import_react4.useEffect)(() => {
    if (!handlers?.onError) return;
    return ctx.onError(handlers.onError);
  }, [handlers?.onError]);
  (0, import_react4.useEffect)(() => {
    if (!handlers?.onEntryRequested) return;
    return ctx.onEntryRequested(handlers.onEntryRequested);
  }, [handlers?.onEntryRequested]);
  (0, import_react4.useEffect)(() => {
    if (!handlers?.onEntryResponded) return;
    return ctx.onEntryResponded(handlers.onEntryResponded);
  }, [handlers?.onEntryResponded]);
  (0, import_react4.useEffect)(() => {
    if (!handlers?.onMeetingLeft) return;
    return ctx.onMeetingLeft(handlers.onMeetingLeft);
  }, [handlers?.onMeetingLeft]);
  const { sdk: _, ...publicApi } = ctx;
  return publicApi;
};

// src/react/useParticipants.ts
var import_react5 = require("react");
var useParticipants = () => {
  const { sdk } = useMeetingContext();
  const [participants, setParticipants] = (0, import_react5.useState)(
    () => sdk.state.getParticipants()
  );
  (0, import_react5.useEffect)(() => {
    const update = () => {
      setParticipants(sdk.state.getParticipants());
    };
    update();
    const unsub = sdk.state.subscribe("participants", update);
    return unsub;
  }, [sdk]);
  return participants;
};

// src/react/useRemoteMedia.ts
var import_react6 = require("react");
var useRemoteMedia = (participantId) => {
  const { sdk } = useMeetingContext();
  const videoRef = (0, import_react6.useRef)(null);
  const audioRef = (0, import_react6.useRef)(null);
  const [participant, setParticipant] = (0, import_react6.useState)(
    () => sdk.state.getParticipant(participantId) || null
  );
  (0, import_react6.useEffect)(() => {
    const unsub = sdk.state.subscribe(`participant:${participantId}`, () => {
      const p = sdk.state.getParticipant(participantId);
      setParticipant(p ? { ...p } : null);
    });
    return unsub;
  }, [participantId, sdk]);
  (0, import_react6.useEffect)(() => {
    const stream = participant?.media?.stream;
    if (!stream) return;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.play().catch(() => {
      });
    }
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {
      });
    }
  }, [participant?.media?.stream]);
  return {
    videoRef,
    audioRef,
    isCamActive: !!participant?.media?.camEnabled,
    isMicEnabled: !!participant?.media?.micEnabled
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MeetingProvider,
  MeetingState,
  VideoSDKCore,
  useLocalParticipant,
  useMeeting,
  useMeetingContext,
  useParticipants,
  useRemoteMedia
});
//# sourceMappingURL=index.js.map