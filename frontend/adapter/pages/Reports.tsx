import { useEffect } from "react";
import { navigate } from "../navigation";

// Old bookmarks keep their property, dates and filters after reports join the overview.
export default function Reports() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const report = params.get("report") || "";
    const section = /revenue/.test(report) ? "revenue"
      : /source|referrer|traffic/.test(report) ? "sources"
      : /page|content/.test(report) ? "content"
      : /event/.test(report) ? "events" : "";
    params.delete("report");
    navigate(`/analytics?${params}${section ? `#${section}` : ""}`, true);
  }, []);
  return null;
}
