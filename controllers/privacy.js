function normalizeHost(value) {
  if (!value) return value ?? null;
  const input = String(value).trim();
  if (!input) return input;

  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
      ? input
      : `https://${input}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "");
  } catch {
    return input.replace(/^www\./i, "");
  }
}

function redactDomain(value) {
  return normalizeHost(value);
}

function redactUrl(value) {
  return normalizeHost(value);
}

function stripSensitiveGlobeUsersPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  return {
    ...payload,
    users: Array.isArray(payload.users)
      ? payload.users.map(({ url, ...user }) => user)
      : payload.users,
    feed: Array.isArray(payload.feed)
      ? payload.feed.map(({ url, ...row }) => row)
      : payload.feed,
    properties: Array.isArray(payload.properties)
      ? payload.properties.map(({ url, domain, ...property }) => ({
          ...property,
          domain: redactDomain(domain),
        }))
      : payload.properties,
  };
}

module.exports = {
  redactDomain,
  redactUrl,
  stripSensitiveGlobeUsersPayload,
};
