import { theme, type ThemeConfig } from "antd";

/**
 * Ant Design theme for the "Угли" (embers) palette: dark surfaces with a fiery
 * orange accent. Chrome colors (sidebar, header, topline) live in `app.css`
 * because AntD does not own those areas.
 */
export const embersTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#ff6a00",
    colorInfo: "#ff6a00",
    colorLink: "#ff8c1a",
    colorBgLayout: "#0e0905",
    colorBgContainer: "#171008",
    colorBgElevated: "#1e1409",
    borderRadius: 10,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  },
  components: {
    Layout: {
      bodyBg: "#0e0905",
      headerBg: "#120b07",
      headerHeight: 60,
      headerPadding: "0 24px",
    },
    Menu: {
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemColor: "#e9d3b8",
      darkItemHoverBg: "rgba(255, 122, 26, 0.1)",
      darkItemSelectedBg: "rgba(255, 122, 26, 0.2)",
      darkItemSelectedColor: "#ffd9ab",
      itemMarginInline: 0,
      itemBorderRadius: 8,
    },
  },
};
