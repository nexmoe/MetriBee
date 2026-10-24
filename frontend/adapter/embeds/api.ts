import { authedFetch } from "../../rybbit/src/api/utils";
import type {
  SavedWidget,
  WidgetConfig,
  WidgetReport,
} from "../../../controllers/widgetConfig";

export const widgetApi = {
  list: (siteId: number) =>
    authedFetch<{ data: SavedWidget[] }>(`/sites/${siteId}/widgets`),
  save: (siteId: number, config: WidgetConfig, id?: string) =>
    authedFetch<{ data: SavedWidget }>(
      `/sites/${siteId}/widgets${id ? "/" + id : ""}`,
      {},
      { method: id ? "PUT" : "POST", data: { config } }
    ),
  remove: (siteId: number, id: string) =>
    authedFetch(`/sites/${siteId}/widgets/${id}`, {}, { method: "DELETE" }),
  preview: (siteId: number, config: WidgetConfig) =>
    authedFetch<{ data: WidgetReport }>(
      `/sites/${siteId}/widgets/preview`,
      {},
      { method: "POST", data: { config } }
    ),
};
