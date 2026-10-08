import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransmitProvider, useTransmitChannel } from "./TransmitContext";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const calls: { path: string; uid: string; channel: string }[] = [];

function Page({ onData }: { onData: (d: unknown) => void }) {
  useTransmitChannel("jobs/42", onData);
  return null;
}

describe("TransmitProvider", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    calls.length = 0;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        const { uid, channel } = JSON.parse(init.body);
        calls.push({ path: url.replace(/^.*__transmit\//, ""), uid, channel });
        return new Response(null, { status: 204 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("subscribes once the stream is open, even with StrictMode's double mount", () => {
    const onData = vi.fn();
    render(
      <StrictMode>
        <TransmitProvider>
          <Page onData={onData} />
        </TransmitProvider>
      </StrictMode>,
    );
    // Nothing is sent before the server knows the stream
    expect(calls).toEqual([]);

    const live = FakeEventSource.instances.find((es) => !es.closed)!;
    const uid = new URL(live.url, "http://x").searchParams.get("uid")!;
    act(() => live.onopen?.());
    expect(calls).toEqual([{ path: "subscribe", uid, channel: "jobs/42" }]);

    act(() => live.onmessage?.({ data: JSON.stringify({ channel: "jobs/42", payload: { status: "DONE" } }) }));
    expect(onData).toHaveBeenCalledWith({ status: "DONE" });
  });

  it("gives every stream its own uid and unsubscribes on the open one", () => {
    const view = render(
      <TransmitProvider>
        <Page onData={() => {}} />
      </TransmitProvider>,
    );
    const es = FakeEventSource.instances[0];
    act(() => es.onopen?.());
    view.rerender(<TransmitProvider>{null}</TransmitProvider>);
    expect(calls.map((c) => c.path)).toEqual(["subscribe", "unsubscribe"]);
    expect(new Set(calls.map((c) => c.uid)).size).toBe(1);
  });
});
