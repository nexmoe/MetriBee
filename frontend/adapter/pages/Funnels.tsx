import NativeFunnelsPage from "../../rybbit/src/app/[site]/funnels/page";
import { useStore } from "../../rybbit/src/lib/store";

export default function FunnelsPage() {
  const site = useStore(state => state.site);
  return <NativeFunnelsPage key={site} />;
}
