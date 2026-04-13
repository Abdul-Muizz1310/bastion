import { describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

describe("Home page", () => {
  it("redirects to /login", async () => {
    const { default: Home } = await import("./page");
    Home();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
