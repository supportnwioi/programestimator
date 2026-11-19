// Cloudflare Worker that fronts the estimator's Node server, which runs in a
// Cloudflare Container. Every request goes to one named container instance so
// students and admins share the same in-memory sessions and files.
import { DurableObject } from 'cloudflare:workers';

const PORT = 8080;
// Keep the container running for 30 minutes after the last request. Its disk is
// ephemeral: settings, estimates and shares reset when it sleeps or redeploys.
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export class EstimatorContainer extends DurableObject {
  starting;

  constructor(ctx, env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
    }
  }

  async fetch(request) {
    this.starting ??= this.startAndWaitForPort().finally(() => { this.starting = undefined; });
    await this.starting;
    const url = new URL(request.url);
    url.protocol = 'http:';
    url.host = 'container';
    const forwarded = new Request(url, request);
    forwarded.headers.delete('host');
    return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container.running) {
      const env = { PORT: String(PORT), NWIOI_DATA_DIR: '/app/data' };
      if (this.env.NWIOI_ADMIN_PASSWORD) env.NWIOI_ADMIN_PASSWORD = this.env.NWIOI_ADMIN_PASSWORD;
      if (this.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = this.env.ANTHROPIC_API_KEY;
      container.start({
        image: container.images.base,
        instance: 'lite',
        // Outbound access is needed to check aasect.org for published changes
        // and, when configured, to call the Claude API for document review.
        enableInternet: true,
        env,
      });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch('http://container/health', { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Server not listening yet.
      }
      await scheduler.wait(200);
    }
    throw new Error(`Container did not become ready on port ${PORT}`);
  }
}

export default {
  async fetch(request, env) {
    try {
      return await env.ESTIMATOR.getByName('estimator').fetch(request);
    } catch (err) {
      console.error('container request failed:', err);
      return new Response('The estimator is starting up. Please refresh in a minute.', { status: 503, headers: { 'retry-after': '30', 'content-type': 'text/plain' } });
    }
  },
};
