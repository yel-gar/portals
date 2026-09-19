import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";

import App from "./App";
import { LiveStatusProvider } from "./live";
import { embersTheme } from "./theme";

import "antd/dist/reset.css";
import "./app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10_000,
    },
  },
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root is missing");
}

createRoot(container).render(
  <StrictMode>
    <ConfigProvider theme={embersTheme} locale={ruRU}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <LiveStatusProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </LiveStatusProvider>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
