import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import PaperTrade from "./PaperTrade";

describe("PaperTrade render test", () => {
  it("renders PaperTrade without throwing", () => {
    expect(() => {
      ReactDOMServer.renderToString(
        <MemoryRouter>
          <AuthProvider>
            <PaperTrade />
          </AuthProvider>
        </MemoryRouter>
      );
    }).not.toThrow();
  });
});
