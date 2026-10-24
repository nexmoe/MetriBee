import { groupPropertiesByAccount } from "../../../public/js/homeAccounts";

export type AccountMetadata = {
  accountId?: string | null;
  accountName?: string | null;
};
export function accountGroups<T extends AccountMetadata>(
  sites: T[],
  grouped: boolean
): {
  accountId: string | null;
  accountName: string;
  properties: T[];
}[] {
  return grouped
    ? groupPropertiesByAccount(sites)
    : [{ accountId: "all", accountName: "", properties: sites }];
}
