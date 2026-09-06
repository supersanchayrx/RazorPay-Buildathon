// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file containerReveal.stylex.ts
 * @input Uses StyleX, theme tokens
 * @output The container style that publishes the reveal state, the suspended
 *   and hover-delay container variants, and the four content style blocks
 *   (reveal / conceal, each with a layout-preserved variant) that read it.
 * @position Internal to useContainerReveal.
 *
 * HOW THE SCOPING WORKS: the container declares its own reveal state as
 * inherited custom properties on itself, and content reads them. Because a
 * nested container re-declares the same properties on itself, its subtree sees
 * the inner value and never the ancestor's — nesting isolation falls out of the
 * cascade, with one static style block for any number of containers.
 *
 * SYNC: When the block shape changes, update useContainerReveal.ts.
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { durationVars, easeVars } from "../theme/tokens.stylex.js";
const REST_DELAY = '0s, ' + durationVars['--duration-fast'];

// The hover-intent gate: how long the pointer must dwell before the hover
// branch takes effect. Declared on every container so a nested one never
// inherits its ancestor's dwell.
const HOVER_DELAY = 'var(--_hover-delay, 0s)';
export const styles = {
  container: {
    "--_hover-delay": "xhg274n",
    "--_reveal-opacity": "xct0gwe x2xrgwu xi33vf3 xi7d7de",
    "--_reveal-position": "xp0pj8v x1or4zte xoa21yc xarvkxi",
    "--_reveal-delay": "x1xiarpw xi1ebb6 x1mjsb9v x1pn63d7",
    "--_reveal-delay-reduced": "xdjmrzf xvd8mm8 x1z42dm xm1aeao",
    "--_conceal-opacity": "x1kgmhs9 x1316hva",
    "--_fade-delay": "x13l1x9d x14nxqze x1wfyzv7 x1hl81f0",
    $$css: true
  },
  stateInactive: {
    "--_reveal-opacity": "xct0gwe xfqgg65 xi33vf3 xi7d7de",
    "--_reveal-position": "xp0pj8v x17ock8y xoa21yc xarvkxi",
    "--_reveal-delay": "x1xiarpw x1tx49wl x1mjsb9v x1pn63d7",
    "--_reveal-delay-reduced": "xdjmrzf xap96qf x1z42dm xm1aeao",
    "--_conceal-opacity": "x1kgmhs9 xuzfaso",
    "--_fade-delay": "x13l1x9d xq03417 x1wfyzv7 x1hl81f0",
    $$css: true
  },
  stateActive: {
    "--_reveal-opacity": "x5setjs x2xrgwu xi33vf3 xi7d7de",
    "--_reveal-position": "x1r6s5ct x1or4zte xoa21yc xarvkxi",
    "--_reveal-delay": "x1dejzja x1t6fdr0 x1mjsb9v x1pn63d7",
    "--_reveal-delay-reduced": "xdjmrzf xap96qf x1z42dm xm1aeao",
    "--_conceal-opacity": "x9pmotm x1316hva",
    "--_fade-delay": "x13l1x9d xq03417 x1wfyzv7 x1hl81f0",
    $$css: true
  },
  hoverDelay: delay => [{
    "--_hover-delay": delay != null ? "x8xu23y" : delay,
    $$css: true
  }, {
    "--x---_hover-delay": delay != null ? delay : undefined
  }],
  reveal: {
    k1ekBW: "x1n1p2mu",
    kIyJzY: "x1tw3moq xsr0bmt",
    kAMwcw: "xlr8y92",
    kzIqYQ: "xd00j3c",
    kIr0Dl: "x1rq8cwj xwgk2z2",
    kSiTet: "xgsobzw",
    kVAEAm: "x1mf7ja4",
    $$css: true
  },
  revealLayoutPreserved: {
    k1ekBW: "x19991ni",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    kIr0Dl: "x4avkj2",
    kSiTet: "xgsobzw",
    $$css: true
  },
  conceal: {
    k1ekBW: "x19991ni",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    kIr0Dl: "x4avkj2",
    kSiTet: "x1wnsjo",
    $$css: true
  },
  concealLayoutPreserved: {
    k1ekBW: "x19991ni",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    kIr0Dl: "x4avkj2",
    kSiTet: "x1wnsjo",
    $$css: true
  },
  contentShown: {
    kSiTet: "x1hc1fzr",
    kVAEAm: "x1uhb9sk",
    kIr0Dl: "x1ahifba",
    $$css: true
  },
  contentHidden: {
    kSiTet: "xg01cxk x1euntei",
    kVAEAm: "x10l6tqk xo74pv5",
    kIr0Dl: "x1ahifba",
    $$css: true
  },
  contentHiddenLayoutPreserved: {
    kSiTet: "xg01cxk x1euntei",
    kIr0Dl: "x1ahifba",
    $$css: true
  }
};