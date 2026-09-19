/**
 * Minimal controllable WebSocket substitute. jsdom does not implement
 * WebSocket, so tests install this onto `globalThis` and drive connection
 * events manually.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Test drivers — simulate the browser side of the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(data: string): void {
    this.onmessage?.({ data });
  }

  error(): void {
    this.onerror?.(new Event("error"));
  }

  /** The server closed the connection with the given code. */
  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason: "" });
  }

  static install(): void {
    FakeWebSocket.instances = [];
    // `vi.stubGlobal` survives jsdom's read-only globals by redefining
    // the property with a configurable descriptor.
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  }
}
