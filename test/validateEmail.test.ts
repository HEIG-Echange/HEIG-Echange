import { describe, it, expect } from "vitest";
import { isAllowedEmailDomain } from "../src/auth/validateEmail";

describe("isAllowedEmailDomain", () => {
  it("accepte un email @heig-vd.ch", () => {
    expect(isAllowedEmailDomain("sofia@heig-vd.ch")).toBe(true);
  });

  it("accepte un email @hes-so.ch et ses sous-domaines", () => {
    expect(isAllowedEmailDomain("quelquun@hes-so.ch")).toBe(true);
    expect(isAllowedEmailDomain("quelquun@edu.hes-so.ch")).toBe(true);
  });

  it("refuse un domaine externe", () => {
    expect(isAllowedEmailDomain("quelquun@gmail.com")).toBe(false);
  });

  it("refuse une chaine sans @", () => {
    expect(isAllowedEmailDomain("pasunemail")).toBe(false);
  });
});
