import NativePages from "../../rybbit/src/app/[site]/pages/page";
import { SearchSummary } from "../overview/SearchSummary";

export default function Pages() {
  return <NativePages summary={<SearchSummary />} />;
}
