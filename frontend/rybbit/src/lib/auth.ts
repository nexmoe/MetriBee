const organization = { id: "ga4", name: "Google Analytics 4", createdAt: new Date(0) };
const session = { user: { id: "ga4-reader", name: "", email: "", role: "viewer" }, session: { activeOrganizationId: "ga4" } };
export const authClient: any = {
  useSession: () => ({ data: session, isPending: false }),
  useActiveOrganization: () => ({ data: organization, isPending: false }),
  useListOrganizations: () => ({ data: [organization], isPending: false }),
  getSession: async () => ({ data: session }),
  signOut: async () => {},
  organization: { setActive: async () => {}, getFullOrganization: async () => ({ data: organization }) },
};
