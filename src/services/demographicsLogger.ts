// Posts a single demographic record (age) to a SharePoint list via a Power
// Automate webhook. Bounded delivery never throws, so it can't break the
// conversation flow. Deduplication (one record per user) is handled by the
// caller via a Redis NX key — this class only does the POST.

export class DemographicsLogger {
  constructor(private readonly webhookUrl: string) {}

  async log(platform: string, userId: string, age: number): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          platform,
          userId,
          age,
          recordedAt: new Date().toISOString(),
        }),
      });
    } catch {
      console.error('[demographics] delivery failed or timed out');
    }
  }
}
