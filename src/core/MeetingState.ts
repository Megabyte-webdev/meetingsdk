import {
  ChatMessage,
  Listener,
  Participant,
  ParticipantMedia,
  StateScope,
} from "../types/meeting";

type LocalParticipantPatch = {
  id?: string;
  name?: string;
  media?: Partial<ParticipantMedia>;
};

export class MeetingState {
  participants = new Map<string, Participant>();
  localParticipant: Participant | null = null;
  localStream: MediaStream | null = null;
  chatMessages = new Map<string, ChatMessage>();
  presenterId: string | null = null;

  private listeners = new Map<StateScope, Set<Listener>>();

  // ---- reactive system ----

  subscribe(scope: StateScope, fn: Listener): () => void {
    if (!this.listeners.has(scope)) {
      this.listeners.set(scope, new Set());
    }
    this.listeners.get(scope)!.add(fn);

    return () => {
      this.listeners.get(scope)?.delete(fn);
    };
  }

  notify(scope: StateScope) {
    this.listeners.get(scope)?.forEach((fn) => fn());
  }

  setPresenterId(id: string | null) {
    if (this.presenterId === id) return;
    this.presenterId = id;
    this.notify("presenter");
    this.notify("participants");
  }

  // ---- participants ----

  addParticipant(p: Participant) {
    if (this.participants.has(p.id)) return false;
    // Fix: Immutable Map update
    const next = new Map(this.participants);
    next.set(p.id, p);
    this.participants = next;

    this.notify("participants");
    return true;
  }

  removeParticipant(id: string) {
    // Fix: Immutable Map update
    const next = new Map(this.participants);
    next.delete(id);
    this.participants = next;

    this.notify("participants");
  }

  updateParticipantMedia(
    id: string,
    patch: Partial<NonNullable<Participant["media"]>>,
  ) {
    const p = this.participants.get(id);
    if (!p) return;

    const updated: Participant = {
      ...p,
      media: {
        stream: null,
        screenStream: undefined,
        cameraTrack: undefined,
        screenTrack: undefined,
        audioTrack: undefined,
        micEnabled: true,
        camEnabled: true,
        isScreenSharing: false,
        ...p.media, // preserve existing media items if they happen to exist
        ...patch, // apply the incoming stream updates
      },
    };

    // Keep your clean immutable map update
    const next = new Map(this.participants);
    next.set(id, updated);
    this.participants = next;

    this.notify(`participant:${id}`);
    this.notify("participants");
  }

  updateLocalParticipant(patch: LocalParticipantPatch) {
    const prev = this.localParticipant;

    if (!prev) {
      this.localParticipant = {
        id: patch.id ?? "",
        name: patch.name ?? "",
        media: {
          stream: patch.media?.stream ?? null, // ◄ FIX: Capture the stream from the patch here
          screenStream: patch.media?.screenStream,
          cameraTrack: patch.media?.cameraTrack,
          screenTrack: patch.media?.screenTrack,
          audioTrack: patch.media?.audioTrack,
          micEnabled: patch.media?.micEnabled ?? true,
          camEnabled: patch.media?.camEnabled ?? true,
          isScreenSharing: patch.media?.isScreenSharing ?? false,
        },
      };

      this.notify("localParticipant");
      return;
    }

    const prevMedia = prev.media ?? {
      stream: null,
      screenStream: undefined,
      cameraTrack: undefined,
      screenTrack: undefined,
      audioTrack: undefined,
      micEnabled: true,
      camEnabled: true,
      isScreenSharing: false,
    };

    const nextMedia: ParticipantMedia = {
      stream: patch.media?.stream ?? prevMedia.stream,
      screenStream: patch.media?.screenStream ?? prevMedia.screenStream,
      cameraTrack: patch.media?.cameraTrack ?? prevMedia.cameraTrack,
      screenTrack: patch.media?.screenTrack ?? prevMedia.screenTrack,
      audioTrack: patch.media?.audioTrack ?? prevMedia.audioTrack,
      micEnabled: patch.media?.micEnabled ?? prevMedia.micEnabled,
      camEnabled: patch.media?.camEnabled ?? prevMedia.camEnabled,
      isScreenSharing:
        patch.media?.isScreenSharing ?? prevMedia.isScreenSharing,
    };

    this.localParticipant = {
      ...prev,
      id: patch.id ?? prev.id,
      name: patch.name ?? prev.name,
      media: nextMedia,
    };

    this.notify("localParticipant");
  }

  // ---- chat ----

  addChatMessage(msg: ChatMessage) {
    this.chatMessages.set(msg.id, msg);
    this.notify("chat");
  }

  getChatMessages() {
    return Array.from(this.chatMessages.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
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

  getParticipant(id: string) {
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
}
