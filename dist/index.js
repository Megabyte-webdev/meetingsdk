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
  useLocalStream: () => useLocalStream,
  useMeeting: () => useMeeting,
  useMeetingContext: () => useMeetingContext,
  useParticipants: () => useParticipants,
  useRemoteVideo: () => useRemoteVideo,
  useStreams: () => useStreams
});
module.exports = __toCommonJS(index_exports);

// src/core/VideoCore.ts
var VideoSDKCore = class {
  constructor(url, state, events = {}) {
    this.url = url;
    this.state = state;
    this.events = events;
    this.ws = null;
    this.peers = {};
    this.initiators = /* @__PURE__ */ new Set();
    this.roomId = null;
    this.localStream = null;
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
      name
    };
    this.state.localStream = this.localStream;
  }
  // ---------------- CONNECT ----------------
  async connect(roomId, name) {
    this.roomId = roomId;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name
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
        this.closePeer(msg.peerId);
        this.state.removeParticipant(msg.peerId);
        this.events.onUserLeft?.(msg.peerId);
        break;
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
  disconnect() {
    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.initiators.clear();
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
  // ---- helpers ----
  getParticipants() {
    return Array.from(this.participants.values());
  }
};

// src/react/MeetingProvider.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var MeetingContext = (0, import_react.createContext)(null);
var MeetingProvider = ({
  core,
  children
}) => {
  const [, setTick] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    const unsub = core["state"].subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsub;
  }, [core]);
  const value = (0, import_react.useMemo)(
    () => ({
      core,
      state: core["state"]
    }),
    [core]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MeetingContext.Provider, { value, children });
};
var useMeetingContext = () => {
  const ctx = (0, import_react.useContext)(MeetingContext);
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
    localParticipant: state.localParticipant
  };
};

// src/react/useParticipants.ts
var import_react2 = require("react");
var useParticipants = () => {
  const { state } = useMeetingContext();
  const [participants, setParticipants] = (0, import_react2.useState)([]);
  (0, import_react2.useEffect)(() => {
    setParticipants(state.getParticipants());
    const unsub = state.subscribe(() => {
      setParticipants(state.getParticipants());
    });
    return () => unsub();
  }, [state]);
  return participants;
};

// src/react/useStreams.ts
var import_react3 = require("react");
var useStreams = () => {
  const { state } = useMeetingContext();
  const [streams, setStreams] = (0, import_react3.useState)(/* @__PURE__ */ new Map());
  (0, import_react3.useEffect)(() => {
    setStreams(new Map(state.streams));
    const unsub = state.subscribe(() => {
      setStreams(new Map(state.streams));
    });
    return () => unsub();
  }, [state]);
  return streams;
};

// src/react/useRemoteVideo.ts
var import_react4 = require("react");
var useRemoteVideo = (participantId) => {
  const ref = (0, import_react4.useRef)(null);
  const { state } = useMeetingContext();
  (0, import_react4.useEffect)(() => {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MeetingProvider,
  MeetingState,
  VideoSDKCore,
  useLocalStream,
  useMeeting,
  useMeetingContext,
  useParticipants,
  useRemoteVideo,
  useStreams
});
//# sourceMappingURL=index.js.map