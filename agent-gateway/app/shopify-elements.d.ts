/**
 * Shopify App Bridge web components, declared for TypeScript.
 *
 * `app.tsx` renders `<s-app-nav>` and `<s-link>`, which App Bridge defines as
 * custom elements at runtime. React 18's types tolerated unknown intrinsic
 * elements; React 19's do not, so the upgrade turned two working lines into
 * build errors. Declaring them here is the fix — not deleting the nav.
 *
 * React 19 also moved the JSX namespace under `react`, so this augments that
 * module rather than the old global `JSX` namespace. It lives in its own file
 * because `globals.d.ts` holds a wildcard ambient module (`*.css`), and adding
 * an import there would turn it into a module and break that declaration.
 */
import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-link": React.DetailedHTMLProps<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        HTMLAnchorElement
      >;
    }
  }
}
