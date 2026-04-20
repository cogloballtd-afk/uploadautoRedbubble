export class GpmClient {
  constructor({ baseUrl, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async listProfiles() {
    const all = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = new URL(`${this.baseUrl}/api/v3/profiles`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "100");

      const payload = await this.#getJson(url);
      if (!payload.success) {
        throw new Error(payload.message || "Failed to list profiles");
      }

      all.push(...(payload.data || []));
      totalPages = payload.pagination?.total_page || 1;
      page += 1;
    } while (page <= totalPages);

    return all;
  }

  async listGroups() {
    const payload = await this.#getJson(`${this.baseUrl}/api/v3/groups`);
    if (!payload.success) {
      throw new Error(payload.message || "Failed to list groups");
    }
    return payload.data || [];
  }

  async startProfile(profileId) {
    const payload = await this.#getJson(`${this.baseUrl}/api/v3/profiles/start/${profileId}`);
    if (!payload.success) {
      throw new Error(payload.message || "Failed to start profile");
    }

    const data = payload.data || {};
    if (!data.remote_debugging_address) {
      throw new Error("Missing remote_debugging_address from GPM start profile response");
    }

    return {
      profileId: data.profile_id || profileId,
      browserLocation: data.browser_location || "",
      remoteDebuggingAddress: data.remote_debugging_address,
      driverPath: data.driver_path || ""
    };
  }

  async closeProfile(profileId) {
    const payload = await this.#getJson(`${this.baseUrl}/api/v3/profiles/close/${profileId}`);
    if (!payload.success) {
      throw new Error(payload.message || "Failed to close profile");
    }
    return payload;
  }

  async #getJson(url) {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`GPM API ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}

