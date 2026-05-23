// IP-based rate limiting backed by Workers KV. Coarse-grained (KV is eventually
// consistent, ~60s propagation) but cheap and plenty for v1 traffic.
//
// Three windows per IP:
//   day:   <= RATE_LIMIT_DAILY publishes in 24h
//   hour:  <= RATE_LIMIT_HOURLY publishes in 1h
//   burst: > BURST_THRESHOLD in 60s requires a Turnstile token
//
// We use atomic-ish read/increment/put. Two concurrent requests can both pass
// the limit by one — acceptable slack at our threshold sizes.

export type RateState = {
  blocked: boolean;
  reason?: "daily" | "hourly";
  needsTurnstile: boolean;
};

export async function checkAndIncrement(
  kv: KVNamespace,
  ip: string,
  limits: { daily: number; hourly: number; burst: number },
): Promise<RateState> {
  const dayKey = `rl:ip:${ip}:day`;
  const hourKey = `rl:ip:${ip}:hour`;
  const burstKey = `rl:ip:${ip}:burst`;

  const [dayRaw, hourRaw, burstRaw] = await Promise.all([
    kv.get(dayKey),
    kv.get(hourKey),
    kv.get(burstKey),
  ]);

  const day = Number(dayRaw ?? 0);
  const hour = Number(hourRaw ?? 0);
  const burst = Number(burstRaw ?? 0);

  if (day >= limits.daily) return { blocked: true, reason: "daily", needsTurnstile: false };
  if (hour >= limits.hourly) return { blocked: true, reason: "hourly", needsTurnstile: false };

  await Promise.all([
    kv.put(dayKey, String(day + 1), { expirationTtl: 86400 }),
    kv.put(hourKey, String(hour + 1), { expirationTtl: 3600 }),
    kv.put(burstKey, String(burst + 1), { expirationTtl: 60 }),
  ]);

  return { blocked: false, needsTurnstile: burst + 1 > limits.burst };
}

export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", ip);
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!resp.ok) return false;
  const json = await resp.json<{ success: boolean }>();
  return json.success === true;
}
