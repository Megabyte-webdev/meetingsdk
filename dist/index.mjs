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
      state: core["state"]
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
    localParticipant: state.localParticipant
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