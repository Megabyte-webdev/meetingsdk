// useChat.ts
import { useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { ChatMessage } from "../types/meeting";

export const useChat = () => {
  const { sdk } = useMeetingContext();
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    sdk.state.getChatMessages(),
  );

  useEffect(() => {
    const unsubscribe = sdk.state.subscribe("chat", () => {
      setMessages(sdk.state.getChatMessages());
    });
    return unsubscribe;
  }, [sdk]);

  return { messages, sendMessage: sdk.sendChatMessage.bind(sdk) };
};
