import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

export const streamdownProps = {
  plugins: { cjk, code, math, mermaid },
  // Native Markdown links preserve footnote targets and browser link actions.
  linkSafety: { enabled: false },
};
