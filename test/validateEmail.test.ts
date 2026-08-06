import { describe, it, expect } from "vitest";
import { isAllowedEmailDomain } from "../src/auth/validateEmail";

describe("isAllowedEmailDomain", () => {
  it("accepte un email @heig-vd.ch", () => {
    expect(isAllowedEmailDomain("sofia@heig-vd.ch")).toBe(true);
  });

  it("refuse un domaine externe", () => {
    expect(isAllowedEmailDomain("quelquun@gmail.com")).toBe(false);
  });

  it("refuse une chaine sans @", () => {
    expect(isAllowedEmailDomain("pasunemail")).toBe(false);
  });
});
