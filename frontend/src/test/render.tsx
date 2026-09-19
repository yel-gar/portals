import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import { MemoryRouter } from "react-router-dom";

import { LiveStatusProvider } from "../live";
import { createQueryClient } from "../queryClient";
import { embersTheme } from "../theme";

interface RenderOptions {
  initialEntries?: string[];
  /** Custom route tree to render (e.g. to observe navigation). */
  routes?: ReactElement;
}

/** Render with the same providers the real app uses (main.tsx), no StrictMode. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const { initialEntries = ["/"], routes } = options;
  const queryClient = createQueryClient({ retry: false, staleTime: 0 });

  const tree = (
    <ConfigProvider theme={embersTheme} locale={ruRU}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <LiveStatusProvider>
            <MemoryRouter initialEntries={initialEntries}>{routes ?? ui}</MemoryRouter>
          </LiveStatusProvider>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );

  return {
    queryClient,
    ...render(tree),
  };
}
