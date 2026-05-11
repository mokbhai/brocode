import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatEmptyStateHero } from "./ChatEmptyStateHero";

describe("ChatEmptyStateHero", () => {
  it("uses the static chat mascot asset", () => {
    const markup = renderToStaticMarkup(<ChatEmptyStateHero projectName="Project" />);

    expect(markup).toContain('src="/brocode-bracket-static.svg"');
    expect(markup).not.toContain("/brocode-bracket-pop.svg");
  });
});
