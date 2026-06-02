// src/config/ws.ts
var SDK_CONFIG = {
  wsUrl: "wss://rust-video-server-sfyf.onrender.com/ws"
};

// src/core/VideoCore.ts
var VideoSDKCore = class {
  constructor(state, events = {}, url = SDK_CONFIG.wsUrl) {
    this.state = state;
    this.events = events;
    this.url = url;
    this.ws = null;
    this.peers = {};
    this.initiators = /* @__PURE__ */ new Set();
    this.roomId = null;
    this.localStream = null;
    this.screenStream = null;
    this.isScreenSharing = false;
    this.pingInterval = null;
    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();
    localStorage.setItem("vsdk_id", this.myId);
  }
  // ---------------- STREAM ----------------
  async initLocal(video, name) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
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
        isScreenSharing: false
      }
    };
    this.state.localStream = this.localStream;
  }
  // ---------------- CONNECT ----------------
  async connect(roomId, name) {
    this.roomId = roomId;
    this.reset();
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name
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
    this.state.reset();
  }
  // ---------------- HANDLE SIGNALS ----------------
  async handle(msg) {
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
          sdp: msg.payload
        });
        break;
      }
      case "ICE":
        try {
          await this.peers[msg.sender]?.addIceCandidate(
            JSON.parse(msg.payload)
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
        if (newMsg.sender_id === this.myId) break;
        this.state.addChatMessage({
          ...newMsg,
          text: newMsg.message,
          sender_id: newMsg.sender_id,
          sender_name: newMsg.sender_name,
          timestamp: new Date(newMsg.timestamp).getTime()
        });
        this.events.onChatMessage?.(msg);
        break;
      }
      case "SCREEN_SHARE_START": {
        this.events.onScreenShareStarted?.(
          msg.sender,
          this.state.getStreamById(msg.sender)
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
  createPeer(id) {
    if (!this.localStream) {
      throw new Error("No local stream");
    }
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
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
        target: id
      });
    };
    return pc;
  }
  // ---------------- OFFER ----------------
  async createOffer(id) {
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
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({
      type: "ANSWER",
      payload: answer.sdp,
      sender: this.myId,
      target: id
    });
  }
  // ---------------- CLEANUP ----------------
  closePeer(id) {
    this.peers[id]?.close();
    delete this.peers[id];
    this.initiators.delete(id);
    this.state.removeStream(id);
  }
  async startScreenShare() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    this.isScreenSharing = true;
    const videoTrack = this.screenStream.getVideoTracks()[0];
    Object.values(this.peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      sender?.replaceTrack(videoTrack);
    });
    this.send({
      type: "SCREEN_SHARE_START",
      sender: this.myId,
      room_id: this.roomId
    });
    return this.screenStream;
  }
  stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.isScreenSharing = false;
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
      target: isPrivate ? payload?.reply_to?.id ?? null : null
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
    this.state.participants.clear();
    this.state.streams.clear();
    this.state.clearChat();
  }
  // ---------------- SEND ----------------
  send(msg) {
    this.ws?.send(JSON.stringify(msg));
  }
};

// src/core/MeetingState.ts
var MeetingState = class {
  constructor() {
    this.participants = /* @__PURE__ */ new Map();
    this.streams = /* @__PURE__ */ new Map();
    this.localParticipant = null;
    this.localStream = null;
    this.listeners = /* @__PURE__ */ new Set();
    this.chatMessages = /* @__PURE__ */ new Map();
  }
  // ---- reactive system ----
  subscribe(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  notify() {
    this.listeners.forEach((fn) => fn());
  }
  // ---- participants ----
  addParticipant(p) {
    if (this.participants.has(p.id)) return false;
    this.participants.set(p.id, p);
    this.notify();
    return true;
  }
  removeParticipant(id) {
    this.participants.delete(id);
    this.streams.delete(id);
    this.notify();
  }
  // ---- streams ----
  setStream(id, stream) {
    this.streams.set(id, stream);
    this.notify();
  }
  getStreamById(id) {
    return this.streams.get(id);
  }
  removeStream(id) {
    this.streams.delete(id);
    this.notify();
  }
  addChatMessage(msg) {
    this.chatMessages.set(msg.id, msg);
    this.notify();
  }
  getChatMessages() {
    return Array.from(this.chatMessages.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }
  clearChat() {
    this.chatMessages.clear();
    this.notify();
  }
  // ---- helpers ----
  getParticipants() {
    return Array.from(this.participants.values());
  }
  reset() {
    this.participants.clear();
    this.streams.clear();
    this.localParticipant = null;
    this.localStream = null;
    this.chatMessages.clear();
    this.notify();
  }
};

// src/react/MeetingProvider.tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { jsx } from "react/jsx-runtime";
var MeetingContext = createContext(null);
var MeetingProvider = ({
  core,
  children
}) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = core["state"].subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsub;
  }, [core]);
  const value = useMemo(
    () => ({
      core,
      state: core["state"],
      sendMessage: core.sendChatMessage.bind(core)
    }),
    [core]
  );
  return /* @__PURE__ */ jsx(MeetingContext.Provider, { value, children });
};
var useMeetingContext = () => {
  const ctx = useContext(MeetingContext);
  if (!ctx) throw new Error("MeetingProvider is missing");
  return ctx;
};

// src/react/useMeeting.ts
var useMeeting = () => {
  const { core, state } = useMeetingContext();
  return {
    join: core.connect.bind(core),
    startLocalStream: core.initLocal.bind(core),
    leave: core.disconnect.bind(core),
    meetingId: core.roomId,
    localParticipant: state.localParticipant,
    usePubSub(type) {
      if (type !== "SECURE_CHAT")
        throw new Error("Only 'SECURE_CHAT' pubsub is supported for now");
      return {
        messages: state.chatMessages,
        publish: core.sendChatMessage.bind(core)
      };
    }
  };
};

// src/react/useParticipants.ts
import { useEffect as useEffect2, useState as useState2 } from "react";
var useParticipants = () => {
  const { state } = useMeetingContext();
  const [participants, setParticipants] = useState2([]);
  useEffect2(() => {
    setParticipants(state.getParticipants());
    const unsub = state.subscribe(() => {
      setParticipants(state.getParticipants());
    });
    return () => unsub();
  }, [state]);
  return participants;
};

// src/react/useStreams.ts
import { useEffect as useEffect3, useState as useState3 } from "react";
var useStreams = () => {
  const { state } = useMeetingContext();
  const [streams, setStreams] = useState3(/* @__PURE__ */ new Map());
  useEffect3(() => {
    setStreams(new Map(state.streams));
    const unsub = state.subscribe(() => {
      setStreams(new Map(state.streams));
    });
    return () => unsub();
  }, [state]);
  return streams;
};

// src/react/useRemoteVideo.ts
import { useEffect as useEffect4, useRef } from "react";
var useRemoteVideo = (participantId) => {
  const ref = useRef(null);
  const { state } = useMeetingContext();
  useEffect4(() => {
    const attach = () => {
      const stream = state.getStreamById(participantId);
      if (stream && ref.current) {
        ref.current.srcObject = stream;
      }
    };
    attach();
    const unsub = state.subscribe(() => {
      attach();
    });
    return () => unsub();
  }, [participantId, state]);
  return ref;
};

// src/react/useLocalStream.ts
var useLocalStream = () => {
  const { state } = useMeetingContext();
  return state.localStream;
};
export {
  MeetingProvider,
  MeetingState,
  VideoSDKCore,
  useLocalStream,
  useMeeting,
  useMeetingContext,
  useParticipants,
  useRemoteVideo,
  useStreams
};
//# sourceMappingURL=index.mjs.map