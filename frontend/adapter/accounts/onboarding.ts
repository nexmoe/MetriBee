import { authClient } from "../../rybbit/src/lib/auth";
import { authedFetch } from "../../rybbit/src/api/utils";
import type { UserOrganization } from "../../rybbit/src/api/admin/endpoints/organizations";

// The original signup page's workspace form stays intact. GA4 properties come
// from the server connection: a domain entered during signup never grants
// access to another organization's analytics.
export async function completeSignupWorkspace(input: {
  name: string;
  slug: string;
  domain: string;
}) {
  const organizations = await authedFetch<UserOrganization[]>(
    "/user/organizations"
  );
  const reusable =
    organizations.find(
      (org) => org.role === "owner" && org.slug === input.slug
    ) ||
    (organizations.length === 1 &&
    organizations[0].role === "owner" &&
    organizations[0].slug.startsWith("metribee-")
      ? organizations[0]
      : null);
  let organizationId = reusable?.id;
  if (!organizationId) {
    const result = await authClient.organization.create({
      name: input.name,
      slug: input.slug,
    });
    if (result.error || !result.data?.id)
      throw new Error(
        result.error?.message || "Failed to create organization."
      );
    organizationId = result.data.id;
  }
  const update = await authClient.organization.update({
    organizationId,
    data: { name: input.name, metadata: { onboardingDomain: input.domain } },
  });
  if (update.error) throw new Error(update.error.message);
  const active = await authClient.organization.setActive({ organizationId });
  if (active.error) throw new Error(active.error.message);
  const available = await authedFetch<{
    properties: { id: string; domain: string; organizationId: string }[];
  }>("/properties/available");
  const property = available.properties.find(
    (item) =>
      item.domain.toLowerCase().replace(/^www\./, "") ===
      input.domain.toLowerCase().replace(/^www\./, "")
  );
  if (property && property.organizationId !== organizationId) {
    await authedFetch(`/organizations/${organizationId}/sites`, undefined, {
      method: "POST",
      data: { propertyId: property.id },
    });
  }
  return { organizationId, siteId: property?.id };
}
