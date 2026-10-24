import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Simulator, { isLegUpcoming, slTgCrossing } from "./Simulator";

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

describe("Date-Aware Upcoming Positions (StockMojo parity)", () => {
  it("marks future date trades as upcoming when simulator is on an earlier date", () => {
    const trade23Oct = {
      id: 1,
      strike: 25000,
      type: "CE",
      action: "buy",
      date: "2026-10-23",
      time: "09:30:00",
    };

    // When simulator is on 22 Oct (earlier date): trade from 23 Oct MUST be upcoming
    expect(isLegUpcoming(trade23Oct, "2026-10-22", "09:30:00")).toBe(true);
    expect(isLegUpcoming(trade23Oct, "2026-10-22", "15:30:00")).toBe(true);
  });

  it("marks past date trades as active (not upcoming) when simulator is on a later date", () => {
    const trade22Oct = {
      id: 2,
      strike: 25000,
      type: "CE",
      action: "buy",
      date: "2026-10-22",
      time: "14:30:00",
    };

    // When simulator is on 23 Oct: trade entered on 22 Oct is in the past, so NOT upcoming
    expect(isLegUpcoming(trade22Oct, "2026-10-23", "09:15:00")).toBe(false);
    expect(isLegUpcoming(trade22Oct, "2026-10-23", "15:30:00")).toBe(false);
  });

  it("handles same-day time progression accurately", () => {
    const tradeToday = {
      id: 3,
      strike: 25000,
      type: "PE",
      action: "sell",
      date: "2026-10-23",
      time: "10:30:00",
    };

    // Before 10:30 on same day -> upcoming
    expect(isLegUpcoming(tradeToday, "2026-10-23", "09:15:00")).toBe(true);
    expect(isLegUpcoming(tradeToday, "2026-10-23", "10:29:00")).toBe(true);

    // At or after 10:30 on same day -> active (not upcoming)
    expect(isLegUpcoming(tradeToday, "2026-10-23", "10:30:00")).toBe(false);
    expect(isLegUpcoming(tradeToday, "2026-10-23", "11:00:00")).toBe(false);
  });

  it("supports legacy legs without date by falling back to time comparison", () => {
    const legacyLeg = {
      id: 4,
      strike: 24500,
      type: "CE",
      action: "buy",
      time: "11:00:00",
    };

    expect(isLegUpcoming(legacyLeg, "10:00:00")).toBe(true);
    expect(isLegUpcoming(legacyLeg, "11:00:00")).toBe(false);
    expect(isLegUpcoming(legacyLeg, "12:00:00")).toBe(false);
  });
});

describe("Stop Loss & Target Trigger Logic (StockMojo parity)", () => {
  it("triggers SL and TG correctly for SELL legs", () => {
    const sellLeg = {
      id: 10,
      action: "sell",
      strike: 25000,
      type: "CE",
      premium: 100,
      slPrice: 125, // Loss if price rises to 125
      tgPrice: 70,  // Profit if price falls to 70
    };

    // Between levels: no trigger
    expect(slTgCrossing(sellLeg, 100)).toBeNull();
    expect(slTgCrossing(sellLeg, 115)).toBeNull();
    expect(slTgCrossing(sellLeg, 85)).toBeNull();

    // Stop Loss hit
    expect(slTgCrossing(sellLeg, 125)).toBe("stop_loss");
    expect(slTgCrossing(sellLeg, 130)).toBe("stop_loss");

    // Target hit
    expect(slTgCrossing(sellLeg, 70)).toBe("target");
    expect(slTgCrossing(sellLeg, 60)).toBe("target");
  });

  it("triggers SL and TG correctly for BUY legs", () => {
    const buyLeg = {
      id: 11,
      action: "buy",
      strike: 25000,
      type: "CE",
      premium: 100,
      slPrice: 75,  // Loss if price falls to 75
      tgPrice: 150, // Profit if price rises to 150
    };

    // Between levels: no trigger
    expect(slTgCrossing(buyLeg, 100)).toBeNull();
    expect(slTgCrossing(buyLeg, 120)).toBeNull();
    expect(slTgCrossing(buyLeg, 85)).toBeNull();

    // Stop Loss hit
    expect(slTgCrossing(buyLeg, 75)).toBe("stop_loss");
    expect(slTgCrossing(buyLeg, 60)).toBe("stop_loss");

    // Target hit
    expect(slTgCrossing(buyLeg, 150)).toBe("target");
    expect(slTgCrossing(buyLeg, 160)).toBe("target");
  });

  it("does not trigger for already exited positions", () => {
    const exitedLeg = {
      id: 12,
      action: "sell",
      strike: 25000,
      type: "CE",
      premium: 100,
      slPrice: 125,
      tgPrice: 70,
      exit: { price: 125, time: "11:00:00", reason: "stop_loss" },
    };

    expect(slTgCrossing(exitedLeg, 130)).toBeNull();
    expect(slTgCrossing(exitedLeg, 60)).toBeNull();
  });
});
