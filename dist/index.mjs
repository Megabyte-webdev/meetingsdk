// src/react/useLocalParticipant.tsx
import { useCallback, useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";

// src/react/MeetingProvider.tsx
import { createContext, useContext, useMemo, useRef } from "react";

// src/config/ws.ts
var SDK_CONFIG = {
  wsUrl: "ws://localhost:8080/ws",
  baseUrl: "http://localhost:8080"
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
        ...patch
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
    this.pubPC = null;
    this.subPC = null;
    this.pendingTracks = /* @__PURE__ */ new Map();
    this.subscriberNegotiating = false;
    this.subscriberOfferQueue = [];
    this.iceServers = [];
    this.lastPong = Date.now();
    this.intentionalDisconnect = false;
    this.room = {
      id: null,
      name: null
    };
    this.localStream = null;
    this.screenStream = null;
    this.screenSender = null;
    this.isScreenSharing = false;
    this.pingInterval = null;
    this.reconnectAttempts = 0;
    this.participantName = "";
    this.isWaitingForApproval = false;
    this.pendingRequestId = null;
    this.iceTransportPolicy = "all";
    this.state = new MeetingState();
    this.events = events;
    this.url = url;
    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();
    localStorage.setItem("vsdk_id", this.myId);
  }
  async acquireLocalMedia(options) {
    const { videoConstraints = true, audioConstraints = true } = options;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraints
      });
      const hasVideo = stream.getVideoTracks().some((t) => t.readyState === "live");
      const hasAudio = stream.getAudioTracks().some((t) => t.readyState === "live");
      return { stream, camEnabled: hasVideo, micEnabled: hasAudio };
    } catch (err) {
      console.warn(
        "[VideoSDKCore] Primary getUserMedia failed:",
        err?.name || err?.message
      );
      const isDeviceLocked = err?.name === "NotReadableError" || err?.name === "TrackStartError" || err?.message?.toLowerCase().includes("allocate videosource") || err?.message?.toLowerCase().includes("could not start video source");
      if (isDeviceLocked) {
        console.warn(
          "[VideoSDKCore] Camera is locked by another browser/app. Falling back to Audio-Only."
        );
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: audioConstraints
          });
          return {
            stream: audioOnlyStream,
            camEnabled: false,
            micEnabled: audioOnlyStream.getAudioTracks().some((t) => t.readyState === "live")
          };
        } catch (audioErr) {
          console.warn(
            "[VideoSDKCore] Audio acquisition also failed. Falling back to View-Only stream."
          );
        }
      }
      return {
        stream: new MediaStream(),
        camEnabled: false,
        micEnabled: false
      };
    }
  }
  // ---------------- MEDIA SETUP ----------------
  async initLocal(video, name) {
    this.participantName = name;
    try {
      const { stream, camEnabled, micEnabled } = await this.acquireLocalMedia({
        videoConstraints: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audioConstraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.localStream = stream;
      console.log(
        "[LOCAL MEDIA]",
        this.localStream.getTracks().map((t) => ({
          kind: t.kind,
          enabled: t.enabled,
          ready: t.readyState
        }))
      );
      if (video && this.localStream.getVideoTracks().length > 0) {
        video.srcObject = this.localStream;
      }
      const cameraTrack = this.localStream.getVideoTracks()[0] || void 0;
      const audioTrack = this.localStream.getAudioTracks()[0] || void 0;
      this.state.updateLocalParticipant({
        id: this.myId,
        name: this.participantName,
        media: {
          stream: this.localStream,
          cameraTrack,
          audioTrack,
          micEnabled,
          camEnabled,
          isScreenSharing: false
        }
      });
      this.state.localStream = this.localStream;
    } catch (err) {
      this.emitError("GET_USER_MEDIA_FAILED", err?.message, err, false);
      throw err;
    }
  }
  async joinMeeting(config) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;
    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }
    this.participantName = name;
    let camEnabled = !videoMuted;
    let micEnabled = !audioMuted;
    if (!this.localStream) {
      const acquired = await this.acquireLocalMedia({
        videoConstraints: !videoMuted,
        audioConstraints: !audioMuted
      });
      this.localStream = acquired.stream;
      console.log(
        "[LOCAL MEDIA]",
        this.localStream.getTracks().map((t) => ({
          kind: t.kind,
          enabled: t.enabled,
          ready: t.readyState
        }))
      );
      camEnabled = acquired.camEnabled && !videoMuted;
      micEnabled = acquired.micEnabled && !audioMuted;
    }
    this.localStream.getAudioTracks().forEach((t) => t.enabled = micEnabled);
    this.localStream.getVideoTracks().forEach((t) => t.enabled = camEnabled);
    const cameraTrack = this.localStream.getVideoTracks()[0] || void 0;
    const audioTrack = this.localStream.getAudioTracks()[0] || void 0;
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        stream: this.localStream,
        cameraTrack,
        audioTrack,
        micEnabled,
        camEnabled,
        isScreenSharing: false
      }
    });
    this.state.localStream = this.localStream;
    await this.connect(roomId, name);
  }
  // ---------------- SFU PEER CONNECTION CREATION ----------------
  setupPublisherPC() {
    if (!this.localStream) return;
    this.pubPC = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy
    });
    const tracksByKind = /* @__PURE__ */ new Map();
    this.localStream.getTracks().forEach((track) => {
      tracksByKind.set(track.kind, track);
    });
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      console.log("[Publisher] Adding audio track:", {
        kind: audioTrack.kind,
        id: audioTrack.id,
        enabled: audioTrack.enabled,
        state: audioTrack.readyState
      });
      try {
        this.pubPC?.addTrack(audioTrack, this.localStream);
      } catch (e) {
        console.error("[Publisher] Failed to add audio track:", e);
      }
    }
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      console.log("[Publisher] Adding video track:", {
        kind: videoTrack.kind,
        id: videoTrack.id,
        enabled: videoTrack.enabled,
        // ✅ Can be false, that's OK
        state: videoTrack.readyState
      });
      try {
        this.pubPC?.addTrack(videoTrack, this.localStream);
      } catch (e) {
        console.error("[Publisher] Failed to add video track:", e);
      }
    }
    this.pubPC.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: "PUB_ICE",
          payload: JSON.stringify(e.candidate),
          user_id: this.myId
        });
      }
    };
    this.pubPC.onconnectionstatechange = () => {
      console.log("[Publisher PC State]", {
        connection: this.pubPC?.connectionState,
        ice: this.pubPC?.iceConnectionState,
        signaling: this.pubPC?.signalingState
      });
      if (this.pubPC?.connectionState === "failed") {
        console.warn("[Publisher] Connection failed, restarting ICE");
        this.restartPublisherIce();
      }
    };
  }
  setupSubscriberPC() {
    this.subPC = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy
    });
    this.subPC.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: "SUB_ICE",
          payload: JSON.stringify(e.candidate),
          user_id: this.myId
        });
      }
    };
    this.subPC.ontrack = (event) => {
      console.log("[SFU ontrack Event]", {
        kind: event.track.kind,
        id: event.track.id,
        mid: event.transceiver.mid,
        streams: event.streams.length
      });
      const stream = event.streams[0] || new MediaStream([event.track]);
      const mid = event.transceiver.mid;
      if (!mid) {
        console.warn("[Subscriber] Track received without MID", event.track);
        return;
      }
      console.log("[Subscriber] Looking for descriptor with MID:", mid, {
        available: [...this.pendingTracks.keys()]
      });
      const descriptor = this.pendingTracks.get(mid);
      if (!descriptor) {
        console.warn("[Subscriber] No descriptor found for MID:", mid);
        console.log("[Subscriber] Pending tracks:", [
          ...this.pendingTracks.entries()
        ]);
        return;
      }
      console.log("[Subscriber] Found descriptor:", descriptor);
      this.pendingTracks.delete(mid);
      switch (descriptor.source) {
        case "camera":
          console.log(
            "[Subscriber] Updating camera for:",
            descriptor.publisher_id
          );
          this.state.updateParticipantMedia(descriptor.publisher_id, {
            stream,
            cameraTrack: event.track
          });
          break;
        case "audio":
          console.log(
            "[Subscriber] Updating audio for:",
            descriptor.publisher_id
          );
          this.state.updateParticipantMedia(descriptor.publisher_id, {
            stream,
            audioTrack: event.track
          });
          break;
        case "screen":
          console.log(
            "[Subscriber] Updating screen for:",
            descriptor.publisher_id
          );
          this.state.updateParticipantMedia(descriptor.publisher_id, {
            screenStream: stream,
            screenTrack: event.track,
            isScreenSharing: true
          });
          break;
      }
    };
    this.subPC.onconnectionstatechange = () => {
      console.log("[SFU Subscriber PC State]", this.subPC?.connectionState);
      if (this.subPC?.connectionState === "failed") {
        console.warn("Subscriber connection failed");
      }
    };
  }
  // ---------------- WEBSOCKET CONNECTION & SIGNALING ----------------
  async connect(roomId, name) {
    this.room.id = roomId;
    this.reset();
    return new Promise((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        console.log("WebSocket connected to SFU, sending JOIN...");
        const micEnabled = !!this.state.localParticipant?.media?.micEnabled;
        const camEnabled = !!this.state.localParticipant?.media?.camEnabled;
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name,
          camera_stream_id: this.localStream?.id.replace(/[{}]/g, ""),
          audio_muted: !micEnabled,
          video_muted: !camEnabled
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
        if (this.intentionalDisconnect || e.code === 1e3 || e.code === 1001 || this.isWaitingForApproval) {
          return;
        }
        this.scheduleReconnect();
      };
      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };
    });
  }
  async handle(msg) {
    if (msg.sender === this.myId) return;
    switch (msg.type) {
      case "PONG":
        this.lastPong = Date.now();
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
        this.setupPublisherPC();
        this.setupSubscriberPC();
        await this.createPublisherOffer();
        const media = this.state.localParticipant?.media;
        if (media) {
          this.send({
            type: "MEDIA_STATE",
            kind: "audio",
            enabled: !!media.micEnabled
          });
          this.send({
            type: "MEDIA_STATE",
            kind: "video",
            enabled: !!media.camEnabled
          });
        }
        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = void 0;
        this.joinRejecter = void 0;
        break;
      }
      case "PUB_ANSWER": {
        if (this.pubPC) {
          await this.pubPC.setRemoteDescription({
            type: "answer",
            sdp: msg.payload
          });
        }
        break;
      }
      case "SUB_OFFER": {
        if (!this.subPC) {
          console.warn("Subscriber PC not ready");
          return;
        }
        const descriptor = msg.track;
        const mid = descriptor.mid;
        console.log(
          "[Signaling] Received SUB_OFFER with descriptor:",
          descriptor
        );
        if (mid) {
          this.pendingTracks.set(mid, descriptor);
          console.log("[Signaling] Stored pending track for MID:", mid);
        }
        if (this.subscriberNegotiating) {
          console.warn("Subscriber negotiating, queueing offer");
          this.subscriberOfferQueue.push(msg);
          return;
        }
        await this.handleSubscriberOffer(msg);
        break;
      }
      case "PUB_ICE": {
        if (this.pubPC && msg.payload) {
          await this.pubPC.addIceCandidate(JSON.parse(msg.payload)).catch(console.warn);
        }
        break;
      }
      case "SUB_ICE": {
        if (this.subPC && msg.payload) {
          await this.subPC.addIceCandidate(JSON.parse(msg.payload)).catch(console.warn);
        }
        break;
      }
      case "EXISTING_USERS": {
        if (msg.presenterId) {
          this.state.setPresenterId(msg.presenterId);
        }
        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;
          const structuredParticipant = {
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            isPresenter: p.isPresenter,
            media: {
              stream: null,
              screenStream: void 0,
              micEnabled: p.micEnabled ?? true,
              camEnabled: p.camEnabled ?? true,
              isScreenSharing: p.isScreenSharing ?? false,
              remoteScreenStreamId: p.remoteScreenStreamId || void 0,
              cameraStreamId: p.cameraId || void 0
            }
          };
          this.state.addParticipant(structuredParticipant);
          this.events.onUserJoined?.(structuredParticipant);
        }
        break;
      }
      case "USER_JOINED": {
        const p = msg.participant;
        if (!p?.id || p.id === this.myId) return;
        this.state.addParticipant(p);
        this.events.onUserJoined?.(p);
        break;
      }
      case "USER_LEFT": {
        const peerId = msg.participant.id;
        this.state.removeParticipant(peerId);
        this.events.onUserLeft?.(peerId);
        break;
      }
      case "MEDIA_STATE_CHANGE": {
        const peerId = msg.peerId;
        const { kind, enabled } = msg;
        if (kind === "audio") {
          this.state.updateParticipantMedia(peerId, { micEnabled: enabled });
          this.events.onMicToggled?.(peerId, enabled);
        } else if (kind === "video") {
          this.state.updateParticipantMedia(peerId, { camEnabled: enabled });
          this.events.onCamToggled?.(peerId, enabled);
        }
        break;
      }
      case "SCREEN_SHARE_START": {
        const peerId = msg.peerId;
        this.state.updateParticipantMedia(peerId, {
          isScreenSharing: true,
          remoteScreenStreamId: msg.stream_id,
          cameraStreamId: msg?.camera_stream_id
        });
        if (!this.state.presenterId) {
          this.state.setPresenterId(peerId);
        }
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
      case "JOIN_PENDING": {
        const req = msg.request;
        this.isWaitingForApproval = true;
        this.pendingRequestId = req.request_id;
        this.events.onEntryRequested?.({
          requestId: req.request_id,
          userId: req.user_id,
          name: req.name
        });
        break;
      }
      case "JOIN_APPROVED": {
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({
            type: "JOIN",
            room_id: this.room.id,
            user_id: this.myId,
            sender_name: this.participantName
          });
        }
        break;
      }
      case "JOIN_REJECTED": {
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        this.events.onEntryResponded?.({
          participantId: msg.user_id,
          decision: "rejected"
        });
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
        if (fatal) this.disconnect();
        return;
      }
    }
  }
  async handleSubscriberOffer(msg) {
    if (!this.subPC) return;
    try {
      this.subscriberNegotiating = true;
      await this.subPC.setRemoteDescription({
        type: "offer",
        sdp: msg.payload
      });
      const answer = await this.subPC.createAnswer();
      await this.subPC.setLocalDescription(answer);
      this.send({
        type: "SUB_ANSWER",
        payload: answer.sdp,
        user_id: this.myId
      });
    } catch (err) {
      console.error("[SUB OFFER ERROR]", err);
    } finally {
      this.subscriberNegotiating = false;
      const next = this.subscriberOfferQueue.shift();
      if (next) {
        await this.handleSubscriberOffer(next);
      }
    }
  }
  // ---------------- PUBLISHER RENEGOTIATION ----------------
  async createPublisherOffer() {
    if (!this.pubPC) return;
    try {
      const offer = await this.pubPC.createOffer();
      await this.pubPC.setLocalDescription(offer);
      this.send({
        type: "PUB_OFFER",
        payload: offer.sdp,
        user_id: this.myId,
        room_id: this.room.id
      });
    } catch (err) {
      console.error("[SFU Publisher Offer Error]", err);
    }
  }
  // ---------------- MEDIA TOGGLES ----------------
  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;
    const nextEnabled = !mediaState.micEnabled;
    this.localStream?.getAudioTracks().forEach((t) => t.enabled = nextEnabled);
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: { ...mediaState, micEnabled: nextEnabled }
    });
    this.send({ type: "MEDIA_STATE", kind: "audio", enabled: nextEnabled });
  }
  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;
    const nextEnabled = !mediaState.camEnabled;
    this.localStream?.getVideoTracks().forEach((t) => t.enabled = nextEnabled);
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: { ...mediaState, camEnabled: nextEnabled }
    });
    this.send({ type: "MEDIA_STATE", kind: "video", enabled: nextEnabled });
  }
  // ---------------- SCREEN SHARING (SFU) ----------------
  async startScreenShare() {
    try {
      if (this.state.presenterId && this.state.presenterId !== this.myId) {
        throw new Error("Another user is already sharing their screen.");
      }
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      this.isScreenSharing = true;
      const screenTrack = this.screenStream.getVideoTracks()[0];
      Object.defineProperty(screenTrack, "contentHint", {
        value: "detail"
      });
      if (this.pubPC) {
        this.screenSender = this.pubPC.addTrack(screenTrack, this.screenStream);
        await this.createPublisherOffer();
      }
      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack
        }
      });
      this.state.setPresenterId(this.myId);
      screenTrack.onended = () => {
        this.stopScreenShare();
      };
      this.send({
        type: "SCREEN_SHARE_START",
        sender: this.myId,
        room_id: this.room.id,
        stream_id: this.screenStream.id.replace(/[{}]/g, "")
      });
      return this.screenStream;
    } catch (err) {
      this.emitError(
        "SCREEN_SHARE_FAILED",
        err?.message || "Failed screen share",
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
    this.screenStream.getTracks().forEach((t) => t.stop());
    if (this.pubPC && this.screenSender) {
      this.pubPC.removeTrack(this.screenSender);
      this.screenSender = null;
      await this.createPublisherOffer();
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
  }
  // ---------------- CHAT & RECONNECT ----------------
  sendChatMessage(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.room.id)
      return;
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
  scheduleReconnect() {
    if (!this.room.id) return;
    const delay = Math.min(1e3 * Math.pow(2, this.reconnectAttempts), 3e4);
    window.clearTimeout(this.reconnectTimer);
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
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "PING", client_ts: Date.now() });
      }
    }, 2e4);
  }
  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  reset() {
    this.pubPC?.close();
    this.subPC?.close();
    this.pubPC = null;
    this.subPC = null;
    this.state.resetRemoteState();
  }
  disconnect() {
    this.intentionalDisconnect = true;
    this.stopScreenShare();
    this.pubPC?.close();
    this.subPC?.close();
    this.pubPC = null;
    this.subPC = null;
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
  async restartPublisherIce() {
    if (!this.pubPC) return;
    try {
      this.pubPC.restartIce();
      await this.createPublisherOffer();
    } catch (err) {
      console.error("[Publisher ICE Restart Failed]", err);
    }
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
  send(msg) {
    this.ws?.send(JSON.stringify(msg));
  }
  approveJoinRequest(requestId) {
    this.send({ type: "JOIN_APPROVE", request_id: requestId });
  }
  rejectJoinRequest(requestId) {
    this.send({ type: "JOIN_REJECT", request_id: requestId });
  }
  getMeeting() {
    return this.room;
  }
};

// src/react/useMeetingStore.ts
import { useEffect, useState } from "react";
function useMeetingStore(stateManager, scope, selector) {
  const [state, setState] = useState(() => selector(stateManager));
  useEffect(() => {
    const unsubscribe = stateManager.subscribe(scope, () => {
      setState(selector(stateManager));
    });
    return unsubscribe;
  }, [stateManager, scope, selector]);
  return state;
}

// src/react/MeetingProvider.tsx
import { jsx } from "react/jsx-runtime";
var MeetingContext = createContext(null);
var MeetingProvider = ({
  config,
  children
}) => {
  const sdkRef = useRef(null);
  const errorListeners = useRef(/* @__PURE__ */ new Set());
  const entryRequestListeners = useRef(/* @__PURE__ */ new Set());
  const entryResponseListeners = useRef(
    /* @__PURE__ */ new Set()
  );
  const meetingLeftListeners = useRef(/* @__PURE__ */ new Set());
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
  const value = useMemo(() => {
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
  return /* @__PURE__ */ jsx(MeetingContext.Provider, { value, children });
};
var useMeetingContext = () => {
  const ctx = useContext(MeetingContext);
  if (!ctx)
    throw new Error("useMeetingContext must be used inside <MeetingProvider>");
  return ctx;
};

// src/react/useLocalParticipant.tsx
var useLocalParticipant = () => {
  const { sdk } = useMeetingContext();
  const [localParticipant, setLocalParticipant] = useState2(
    () => {
      const current = sdk.state.localParticipant;
      return current && current.id ? current : null;
    }
  );
  useEffect2(() => {
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
  const lastStreamRef = useRef2(null);
  const videoRef = useCallback(
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
import { useEffect as useEffect3 } from "react";
var useMeeting = (handlers) => {
  const ctx = useMeetingContext();
  useEffect3(() => {
    if (!handlers?.onError) return;
    return ctx.onError(handlers.onError);
  }, [handlers?.onError]);
  useEffect3(() => {
    if (!handlers?.onEntryRequested) return;
    return ctx.onEntryRequested(handlers.onEntryRequested);
  }, [handlers?.onEntryRequested]);
  useEffect3(() => {
    if (!handlers?.onEntryResponded) return;
    return ctx.onEntryResponded(handlers.onEntryResponded);
  }, [handlers?.onEntryResponded]);
  useEffect3(() => {
    if (!handlers?.onMeetingLeft) return;
    return ctx.onMeetingLeft(handlers.onMeetingLeft);
  }, [handlers?.onMeetingLeft]);
  const { sdk: _, ...publicApi } = ctx;
  return publicApi;
};

// src/react/useParticipants.ts
import { useEffect as useEffect4, useState as useState3 } from "react";
var useParticipants = () => {
  const { sdk } = useMeetingContext();
  const [participants, setParticipants] = useState3(
    () => sdk.state.getParticipants()
  );
  useEffect4(() => {
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
import { useEffect as useEffect5, useRef as useRef3, useState as useState4 } from "react";
var useRemoteMedia = (participantId) => {
  const { sdk } = useMeetingContext();
  const videoRef = useRef3(null);
  const audioRef = useRef3(null);
  const [participant, setParticipant] = useState4(
    () => sdk.state.getParticipant(participantId) || null
  );
  useEffect5(() => {
    const unsub = sdk.state.subscribe(`participant:${participantId}`, () => {
      const p = sdk.state.getParticipant(participantId);
      setParticipant(p ? { ...p } : null);
    });
    return unsub;
  }, [participantId, sdk]);
  useEffect5(() => {
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

// src/react/useMeetingPreview.ts
import { useEffect as useEffect6, useState as useState5 } from "react";
function useMeetingPreview(roomId, userId) {
  const [room, setRoom] = useState5(null);
  const [error, setError] = useState5(null);
  const [isConnected, setIsConnected] = useState5(false);
  const [isLoading, setIsLoading] = useState5(true);
  useEffect6(() => {
    if (!roomId || !userId) {
      setIsLoading(false);
      return;
    }
    let ws = null;
    const heartbeat = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "PING"
          })
        );
      }
    }, 2e4);
    ws = new WebSocket(`${SDK_CONFIG.wsUrl}/watch/${roomId}?user_id=${userId}`);
    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
      console.log("[Preview] watcher connected");
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "ROOM_PRESENCE_UPDATE") {
          return;
        }
        setRoom({
          active: msg.active ?? false,
          count: msg.count ?? 0,
          canJoin: msg.canJoin ?? false,
          approved: msg.approved ?? false,
          isHost: msg.isHost ?? false,
          hasMoreParticipants: msg.hasMoreParticipants ?? false,
          participants: msg.participants ?? []
        });
        setIsLoading(false);
      } catch (err) {
        console.error("Invalid room presence payload", err);
        setIsLoading(false);
      }
    };
    ws.onerror = () => {
      setError("Failed to connect to room monitor");
      setIsLoading(false);
    };
    ws.onclose = () => {
      setIsConnected(false);
      console.log("[Preview] disconnected");
    };
    return () => {
      clearInterval(heartbeat);
      if (ws) {
        ws.close(1e3, "Leaving preview");
      }
    };
  }, [roomId, userId]);
  return {
    room,
    isConnected,
    isLoading,
    error
  };
}
export {
  MeetingProvider,
  MeetingState,
  VideoSDKCore,
  useLocalParticipant,
  useMeeting,
  useMeetingContext,
  useMeetingPreview,
  useParticipants,
  useRemoteMedia
};
//# sourceMappingURL=index.mjs.map