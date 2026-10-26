import type { NotificationProvider, NotificationSendResult } from "@/lib/kakao/notify";

export type RecordedNotification = Parameters<NotificationProvider["send"]>[0];

/** send() is an adapter attempt recorder here, not a network/message sender. */
export class RecordingNotificationProvider implements NotificationProvider {
  readonly attempts: RecordedNotification[] = [];

  constructor(private readonly failure?: Error) {}

  async send(input: RecordedNotification): Promise<NotificationSendResult> {
    this.attempts.push(input);
    if (this.failure) throw this.failure;
    return { status: "skipped" };
  }
}

// Synthetic negative probes only; none belongs in event records or payloads.
export const privateProbes = [
  "SYNTHETIC_CHILD_NAME",
  "SYNTHETIC_GUARDIAN_NAME",
  "010-0000-1234",
  "987654321",
  "SYNTHETIC_CAPABILITY_TOKEN",
  "000-123-456789",
] as const;
