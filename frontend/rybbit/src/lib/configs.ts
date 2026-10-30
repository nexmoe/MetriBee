import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../api/utils";

interface Configs {
  disableSignup: boolean;
  mailConfigured: boolean;
  socialProviders: string[];
  mapboxToken: string;
  liteDashboard: boolean;
}

export function useConfigs() {
  const { data, isLoading, error } = useQuery<Configs>({
    queryKey: ["configs"],
    queryFn: () => authedFetch<Configs>("/config"),
  });

  return {
    configs: data,
    isLoading,
    error,
  };
}
