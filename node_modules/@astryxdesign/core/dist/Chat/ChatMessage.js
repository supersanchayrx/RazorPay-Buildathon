// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ChatMessage.tsx
 * @input Uses React, StyleX, ChatContext, theme tokens
 * @output Exports ChatMessage component and ChatMessageProps
 * @position Sender context wrapper — handles avatar, name, alignment by sender role
 *
 * Layout (with avatar):
 *   [Avatar] [Name              ]
 *            [Content/Bubbles   ]
 *            [Metadata          ]
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Chat/index.ts (exports)
 * - /apps/storybook/stories/Chat.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/ChatMessage/ (block examples)
 */
import { useMemo, useId } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, fontWeightVars } from "../theme/tokens.stylex.js";
import { ChatMessageContext, useChatListContext } from "./ChatContext.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  root: {
    k1xSpc: "x78zum5",
    kGNEyG: "x1cy8zhl",
    ks0D6T: "x193iq5w",
    $$css: true
  },
  rootGapCompact: {
    kOIVth: "x1s4dlld",
    $$css: true
  },
  rootGapBalanced: {
    kOIVth: "x1txdalj",
    $$css: true
  },
  rootGapSpacious: {
    kOIVth: "xjcht0a",
    $$css: true
  },
  rootAssistant: {
    kXwgrk: "x1q0g3np",
    kjj79g: "x1nhvcw1",
    $$css: true
  },
  rootUser: {
    kXwgrk: "x15zctf7",
    kjj79g: "x1nhvcw1",
    $$css: true
  },
  rootSystem: {
    kXwgrk: "x1q0g3np",
    kjj79g: "xl56j7k",
    $$css: true
  },
  contentColumn: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kUk6DE: "x98rzlu",
    k7Eaqz: "xeuugli",
    $$css: true
  },
  contentColumnSystem: {
    ks0D6T: "xq8v1hd",
    kGNEyG: "x6s0dn4",
    $$css: true
  },
  contentColumnAssistant: {
    kGNEyG: "x1cy8zhl",
    $$css: true
  },
  contentColumnUser: {
    kGNEyG: "xuk3077",
    $$css: true
  },
  childrenWrap: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    k7Eaqz: "xeuugli",
    kzqmXN: "xh8yej3",
    $$css: true
  },
  childrenAssistant: {
    kGNEyG: "x1cy8zhl",
    $$css: true
  },
  childrenUser: {
    kGNEyG: "xuk3077",
    $$css: true
  },
  childrenSystem: {
    kGNEyG: "x6s0dn4",
    $$css: true
  },
  childrenGapCompact: {
    kOIVth: "x1lsbc85",
    $$css: true
  },
  childrenGapBalanced: {
    kOIVth: "xzye2dw",
    $$css: true
  },
  childrenGapSpacious: {
    kOIVth: "x1s4dlld",
    $$css: true
  }
};

/**
 * Sender context wrapper for chat messages.
 *
 * Provides sender and density context to child components.
 * Use ChatMessageMetadata as a child for timestamp, status, and footer.
 *
 * @example
 * ```
 * <ChatMessage sender="assistant" name="Navi" avatar={<Avatar name="Navi" size="md" />}>
 *   <ChatMessageBubble>Hello!</ChatMessageBubble>
 *   <ChatMessageMetadata timestamp="2:30 PM" />
 * </ChatMessage>
 * ```
 */
export function ChatMessage({
  sender,
  children,
  avatar,
  name,
  metadata,
  density: densityProp,
  xstyle,
  className,
  style: styleProp,
  'data-testid': testId,
  ref,
  ...rest
}) {
  const t = useTranslator();
  const listContext = useChatListContext();
  const density = densityProp ?? listContext?.density ?? 'balanced';
  const contextValue = useMemo(() => ({
    sender,
    density
  }), [sender, density]);
  const rootGap = density === 'compact' ? styles.rootGapCompact : density === 'spacious' ? styles.rootGapSpacious : styles.rootGapBalanced;
  const childrenGap = density === 'compact' ? styles.childrenGapCompact : density === 'spacious' ? styles.childrenGapSpacious : styles.childrenGapBalanced;
  const rootAlignment = sender === 'system' ? styles.rootSystem : sender === 'user' ? styles.rootUser : styles.rootAssistant;
  const columnAlignment = sender === 'system' ? styles.contentColumnSystem : sender === 'user' ? styles.contentColumnUser : styles.contentColumnAssistant;
  const childrenAlignment = sender === 'system' ? styles.childrenSystem : sender === 'user' ? styles.childrenUser : styles.childrenAssistant;
  const isSystem = sender === 'system';
  const hasAvatar = avatar != null && !isSystem;
  const hasName = name != null && !isSystem;
  const nameId = useId();
  return /*#__PURE__*/_jsx(ChatMessageContext, {
    value: contextValue,
    children: /*#__PURE__*/_jsxs("article", {
      ...rest,
      ref: ref,
      "data-testid": testId,
      "aria-label": !hasName ? t('@astryx.chatMessage.messageFrom', {
        sender
      }) : undefined,
      "aria-labelledby": hasName ? nameId : undefined,
      ...mergeProps(themeProps('chat-message', {
        sender,
        density
      }), stylex.props(styles.root, rootAlignment, hasAvatar && rootGap, xstyle), className, styleProp),
      children: [hasAvatar && /*#__PURE__*/_jsx("div", {
        ...{
          className: "x2lah0s x5du68j"
        },
        children: avatar
      }), /*#__PURE__*/_jsxs("div", {
        ...stylex.props(styles.contentColumn, columnAlignment),
        children: [hasName && /*#__PURE__*/_jsx("div", {
          id: nameId,
          ...{
            className: "x141an7d x2mo6ok xv1l7n4 x1ltkj2j x14cgwvg"
          },
          children: name
        }), /*#__PURE__*/_jsx("div", {
          ...stylex.props(styles.childrenWrap, childrenAlignment, childrenGap),
          children: children
        }), metadata != null && !isSystem && /*#__PURE__*/_jsx("div", {
          children: metadata
        })]
      })]
    })
  });
}
ChatMessage.displayName = 'ChatMessage';