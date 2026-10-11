import { describe, expect, it, vi } from "vitest";
import { watchClientErrors } from "./clientErrors";

describe("watchClientErrors", () => {
  it("sends each error of the page once, never a resource that failed to load", () => {
    const target = new EventTarget() as unknown as Window;
    Object.defineProperty(target, "location", { value: { pathname: "/abc" } });
    const report = vi.fn();
    const stop = watchClientErrors(target, report);

    const boom = new Error("Cannot read properties of undefined");
    target.dispatchEvent(new ErrorEvent("error", { message: boom.message, error: boom }));
    target.dispatchEvent(new ErrorEvent("error", { message: boom.message, error: boom }));
    target.dispatchEvent(new ErrorEvent("error", { message: "" })); // an <img> that 404s
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: new Error("Failed to fetch") });
    target.dispatchEvent(rejection);

    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[0][0]).toMatchObject({ kind: "error", message: "Cannot read properties of undefined", page: "/abc" });
    expect(report.mock.calls[1][0]).toMatchObject({ kind: "rejection", message: "Failed to fetch" });

    stop();
    target.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("stops after 20 different errors", () => {
    const target = new EventTarget() as unknown as Window;
    Object.defineProperty(target, "location", { value: { pathname: "/" } });
    const report = vi.fn();
    watchClientErrors(target, report);
    for (let i = 0; i < 30; i++) target.dispatchEvent(new ErrorEvent("error", { message: `error ${i}` }));
    expect(report).toHaveBeenCalledTimes(20);
  });
});
