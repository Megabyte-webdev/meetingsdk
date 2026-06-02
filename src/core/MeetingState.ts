import { ChatMessage, Listener, Participant } from "../types/meeting";

export class MeetingState {
  participants = new Map<string, Participant>();
  streams = new Map<string, MediaStream>();

  localParticipant: Participant | null = null;
  localStream: MediaStream | null = null;

  private listeners: Set<Listener> = new Set();

  chatMessages = new Map<string, ChatMessage>();

  // ---- reactive system ----
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);

    return (): void => {
      this.listeners.delete(fn);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  // ---- participants ----
  addParticipant(p: Participant) {
    if (this.participants.has(p.id)) return false;
    this.participants.set(p.id, p);
    this.notify();
    return true;
  }

  removeParticipant(id: string) {
    this.participants.delete(id);
    this.streams.delete(id);
    this.notify();
  }

  // ---- streams ----
  setStream(id: string, stream: MediaStream) {
    this.streams.set(id, stream);
    this.notify();
  }
  getStreamById(id: string) {
    return this.streams.get(id);
  }

  removeStream(id: string) {
    this.streams.delete(id);
    this.notify();
  }

  addChatMessage(msg: ChatMessage) {
    this.chatMessages.set(msg.id, msg);
    this.notify();
  }

  getChatMessages() {
    return Array.from(this.chatMessages.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
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
}
