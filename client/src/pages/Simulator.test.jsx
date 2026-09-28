import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Simulator from "./Simulator";

describe("Simulator render test", () => {
  it("renders Simulator without throwing", () => {
    try {
      ReactDOMServer.renderToString(
        <MemoryRouter>
          <Simulator />
        </MemoryRouter>
      );
    } catch (err) {
      console.error("DEBUG STACK:", err);
      throw err;
    }
  });
});
