import { authClient } from "../../rybbit/src/lib/auth";
import { authedFetch } from "../../rybbit/src/api/utils";
import type { UserOrganization } from "../../rybbit/src/api/admin/endpoints/organizations";

// GA4 properties are synchronized by the server. Signup only configures the
// workspace; the bootstrap owner's existing property assignments stay intact.
export async function completeSignupWorkspace(input: {
  name: string;
  slug: string;
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
    data: { name: input.name },
  });
  if (update.error) throw new Error(update.error.message);
  const active = await authClient.organization.setActive({ organizationId });
  if (active.error) throw new Error(active.error.message);
  return { organizationId };
}
