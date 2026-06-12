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
    this.roomId = null;
    this.localStream = null;
    this.screenStream = null;
    this.isScreenSharing = false;
    this.screenSenders = {};
    this.pingInterval = null;
    this.pendingIceCandidates = {};
    this.reconnectAttempts = 0;
    this.participantName = "";
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
      roomId: this.roomId,
      userId: this.myId,
      recoverable
    };
    this.events.onError?.(err);
    this.joinRejecter?.(err);
    this.joinRejecter = void 0;
    console.error("[MeetingSDK Error]", err);
  }
  // ---------------- STREAM ----------------
  async initLocal(video, name) {
    this.participantName = name;
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
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
  }
  // ---------------- CONNECT ----------------
  async connect(roomId, name) {
    this.roomId = roomId;
    this.reset();
    return new Promise((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
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
        this.emitError(
          "WS_CLOSED",
          `Connection closed (${e.code}) ${e.reason || ""}`,
          e,
          true
        );
        this.joinRejecter?.({
          code: "WS_CLOSED",
          message: "Connection closed before join completed",
          raw: e
        });
        this.joinRejecter = void 0;
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
  /** Expose the roomId without making it fully public */
  getMeetingId() {
    return this.roomId;
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
    if (!this.roomId) return;
    const delay = Math.min(1e3 * Math.pow(2, this.reconnectAttempts), 3e4);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(async () => {
      try {
        await this.connect(this.roomId, this.participantName);
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
  // ---------------- RESET ----------------
  reset() {
    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.initiators.clear();
    this.pendingIceCandidates = {};
    this.state.resetRemoteState();
  }
  // ---------------- HANDLE SIGNALS ----------------
  async handle(msg) {
    var _a, _b, _c, _d;
    if (msg.sender === this.myId) return;
    switch (msg.type) {
      case "EXISTING_USERS":
        if (msg.presenterId) {
          this.state.setPresenterId(msg.presenterId);
          this.events.onScreenShareStarted?.(msg.presenterId, null);
        }
        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;
          this.state.addParticipant(p);
          this.events.onUserJoined?.(p);
          await this.createOffer(p.id);
        }
        break;
      case "JOINED": {
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
          sdp: msg.payload
        });
        await this.flushIce(msg.sender, pc);
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
        const screenStream = this.state.getParticipant(peerId2)?.media?.screenStream;
        this.events.onScreenShareStarted?.(peerId2, screenStream || null);
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
  // ---------------- PEER ----------------
  createPeer(id) {
    if (!this.localStream) throw new Error("No local stream");
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302"
          ]
        }
      ]
    });
    pc.ontrack = (event) => {
      const incomingStream = event.streams[0];
      const participant = this.state.getParticipant(id);
      const isScreenStream = incomingStream.id === participant?.media?.remoteScreenStreamId;
      if (isScreenStream) {
        const videoTrack = event.track.kind === "video" ? event.track : incomingStream.getVideoTracks()[0] || participant?.media?.screenTrack;
        this.state.updateParticipantMedia(id, {
          screenStream: incomingStream,
          screenTrack: videoTrack,
          isScreenSharing: true
        });
        if (!this.state.presenterId) {
          this.state.setPresenterId(id);
        }
        this.events.onScreenShareStarted?.(id, incomingStream);
      } else {
        this.state.updateParticipantMedia(id, {
          stream: incomingStream,
          cameraTrack: incomingStream.getVideoTracks()[0]
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
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch {
        }
      }
    };
    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });
    if (this.isScreenSharing && this.screenStream) {
      this.screenSenders[id] = [];
      this.screenStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, this.screenStream);
        this.screenSenders[id].push(sender);
      });
    }
    return pc;
  }
  // ---------------- OFFER ----------------
  async createOffer(id, isRenegotiation = false) {
    if (!isRenegotiation && this.initiators.has(id)) return;
    if (!isRenegotiation) {
      this.initiators.add(id);
    }
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
      target: id
    });
  }
  // ---------------- ANSWER ----------------
  async handleOffer(sdp, id) {
    if (!this.peers[id]) {
      this.peers[id] = this.createPeer(id);
    }
    const pc = this.peers[id];
    await pc.setRemoteDescription({
      type: "offer",
      sdp
    });
    const pending = this.pendingIceCandidates[id] || [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn(err);
      }
    }
    delete this.pendingIceCandidates[id];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.flushIce(id, pc);
    this.send({
      type: "ANSWER",
      payload: answer.sdp,
      sender: this.myId,
      target: id
    });
  }
  // ---------------- CLEANUP ----------------
  closePeer(id) {
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
    if (this.state.presenterId && this.state.presenterId !== this.myId) {
      throw new Error("Another user is already sharing their screen.");
    }
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    this.isScreenSharing = true;
    this.state.updateLocalParticipant({
      media: {
        isScreenSharing: true,
        screenStream: this.screenStream
      }
    });
    this.state.setPresenterId(this.myId);
    this.screenStream.getVideoTracks()[0].onended = () => {
      this.stopScreenShare();
    };
    Object.entries(this.peers).forEach(([peerId, pc]) => {
      this.screenSenders[peerId] = [];
      this.screenStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, this.screenStream);
        this.screenSenders[peerId].push(sender);
      });
      this.createOffer(peerId, true);
    });
    this.send({
      type: "SCREEN_SHARE_START",
      sender: this.myId,
      room_id: this.roomId,
      stream_id: this.screenStream.id.replace(/[{}]/g, "")
    });
    return this.screenStream;
  }
  stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((t) => t.stop());
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
      this.createOffer(peerId, true);
    });
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
      room_id: this.roomId
    });
  }
  sendChatMessage(payload) {
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
      room_id: this.roomId,
      target: isPrivate ? payload.target ?? null : null,
      reply_to: payload.reply_to ?? null,
      client_ts: Date.now()
    });
  }
  disconnect() {
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
    this.roomId = null;
    this.state.localParticipant = null;
    this.state.notify("localParticipant");
    this.state.participants.clear();
    this.state.notify("participants");
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
  if (!sdkRef.current) {
    sdkRef.current = new VideoSDKCore({
      onError: (err) => {
        errorListeners.current.forEach((fn) => fn(err));
      }
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
      meetingId: sdk.getMeetingId(),
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
      onError: (cb) => {
        errorListeners.current.add(cb);
        return () => {
          errorListeners.current.delete(cb);
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
      video.muted = true;
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
    const unsubscribe = ctx.onError(handlers.onError);
    return unsubscribe;
  }, [handlers?.onError]);
  return ctx;
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
  const [participant, setParticipant] = (0, import_react6.useState)(() => {
    return sdk.state.getParticipant(participantId) || null;
  });
  (0, import_react6.useEffect)(() => {
    return sdk.state.subscribe(`participant:${participantId}`, () => {
      const updated = sdk.state.getParticipant(participantId);
      if (updated) setParticipant({ ...updated });
    });
  }, [participantId, sdk]);
  const stream = participant?.media?.stream;
  const videoTrack = participant?.media?.cameraTrack;
  const audioTrack = participant?.media?.audioTrack;
  const isCamActive = !!participant?.media?.camEnabled;
  const isMicEnabled = !!participant?.media?.micEnabled;
  const videoRef = (0, import_react6.useCallback)(
    (el) => {
      if (!el) return;
      let streamToUse = null;
      if (videoTrack && videoTrack.kind === "video") {
        if (videoTrack.readyState === "live") {
          streamToUse = new MediaStream([videoTrack]);
        }
      } else if (stream instanceof MediaStream) {
        streamToUse = stream;
      }
      if (!streamToUse) return;
      if (el.srcObject !== streamToUse) {
        el.srcObject = streamToUse;
      }
      el.play().catch(() => {
      });
    },
    [stream, videoTrack]
  );
  const audioRef = (0, import_react6.useCallback)(
    (el) => {
      if (!el) return;
      let audioStream = null;
      if (audioTrack && audioTrack.kind === "audio") {
        if (audioTrack.readyState === "live") {
          audioStream = new MediaStream([audioTrack]);
        }
      } else if (stream instanceof MediaStream) {
        audioStream = stream;
      }
      if (!audioStream) return;
      if (el.srcObject !== audioStream) {
        el.srcObject = audioStream;
      }
      el.play().catch(() => {
      });
    },
    [stream, audioTrack]
  );
  return {
    videoRef,
    audioRef,
    isCamActive,
    isMicEnabled
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