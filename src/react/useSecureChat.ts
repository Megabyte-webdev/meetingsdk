import { useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { ChatMessage } from "../types/meeting";

export const useSecureChat = () => {
  const { state, sendMessage } = useMeetingContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setMessages(state.getChatMessages());

    const unsub = state.subscribe(() => {
      setMessages(state.getChatMessages());
    });

    return () => unsub();
  }, [state]);

  return {
    messages,
    sendMessage,
  };
};
