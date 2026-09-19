import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import { MemoryRouter } from "react-router-dom";

import { LiveStatusProvider } from "../live";
import { embersTheme } from "../theme";

interface RenderOptions {
  initialEntries?: string[];
  /** Custom route tree to render (e.g. to observe navigation). */
  routes?: ReactElement;
}

/** Render with the same providers the real app uses (main.tsx), no StrictMode. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const { initialEntries = ["/"], routes } = options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const tree = (
    <ConfigProvider theme={embersTheme}>
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
