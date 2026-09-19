import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";

import App from "./App";
import { LiveStatusProvider } from "./live";
import { createQueryClient } from "./queryClient";
import { embersTheme } from "./theme";

import "antd/dist/reset.css";
import "./app.css";

const queryClient = createQueryClient();

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
