// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Chat component barrel export
 *
 * SYNC: When modified, update /packages/core/src/index.ts
 */
export { ChatComposer } from "./ChatComposer.js";
export { ChatSendButton } from "./ChatSendButton.js";
export { ChatComposerDrawer } from "./ChatComposerDrawer.js";
export { ChatComposerInput, ChatComposerTokenElement } from "./ChatComposerInput.js";
export { ChatTokenizedText } from "./ChatTokenizedText.js";
export { ChatMessageList } from "./ChatMessageList.js";
export { ChatMessage } from "./ChatMessage.js";
export { ChatMessageBubble } from "./ChatMessageBubble.js";
export { ChatMessageMetadata } from "./ChatMessageMetadata.js";
export { ChatSystemMessage } from "./ChatSystemMessage.js";
export { useChatStreamScroll } from "./useChatStreamScroll.js";
export { useChatNewMessages } from "./useChatNewMessages.js";
export { useChatPasteAsToken } from "./useChatPasteAsToken.js";
export { useChatComposerTokens } from "./useChatComposerTokens.js";
export { useChatLayoutContext, useChatComposerContext } from "./ChatContext.js";
export { ChatToolCalls } from "./ChatToolCalls.js";
export { ChatLayout } from "./ChatLayout.js";
export { ChatLayoutScrollButton } from "./ChatLayoutScrollButton.js";
export { useSpeechRecognition } from "./useSpeechRecognition.js";
export { useChatDictation } from "./useChatDictation.js";
export { ChatDictationButton } from "./ChatDictationButton.js";