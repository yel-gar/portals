import { describe, expect, it } from "vitest";

import { actionLogQuery, portalListQuery } from "./endpoints";

describe("portalListQuery", () => {
  it("maps portal list params to backend query names", () => {
    expect(
      portalListQuery({
        page: 2,
        itemsPerPage: 10,
        closed: false,
        dangerLevel: "MEDIUM",
        hasObserver: true,
        isMarked: false,
        search: "альф",
        orderBy: "name"
      })
    ).toEqual({
      page: 2,
      items_per_page: 10,
      closed: false,
      danger_level: "MEDIUM",
      has_observer: true,
      is_marked: false,
      search: "альф",
      order_by: "name"
    });
  });

  it("omits unset filters and empty search", () => {
    expect(portalListQuery({ page: 1, itemsPerPage: 20, orderBy: "risk" })).toEqual({
      page: 1,
      items_per_page: 20,
      closed: undefined,
      danger_level: undefined,
      has_observer: undefined,
      is_marked: undefined,
      search: undefined,
      order_by: "risk"
    });
    expect(portalListQuery({ page: 1, itemsPerPage: 20, search: "", orderBy: "creatures" }).search).toBeUndefined();
  });
});

describe("actionLogQuery", () => {
  it("maps log params to backend query names", () => {
    expect(actionLogQuery({ page: 3, itemsPerPage: 50, action: "CLOSE", orderBy: "oldest" })).toEqual({
      page: 3,
      items_per_page: 50,
      action: "CLOSE",
      order_by: "oldest"
    });
  });

  it("omits an unset action filter", () => {
    expect(actionLogQuery({ page: 1, itemsPerPage: 20, orderBy: "newest" }).action).toBeUndefined();
  });
});
