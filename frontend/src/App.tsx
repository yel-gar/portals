import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { RequireAuth, RequireSuperuser } from "./components/RequireAuth";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { LogPage } from "./pages/LogPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PortalsPage } from "./pages/PortalsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { StatsPage } from "./pages/StatsPage";
import { WorklogPage } from "./pages/WorklogPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/portals" replace />} />
        <Route path="/portals" element={<PortalsPage />} />
        <Route path="/log" element={<LogPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/worklog" element={<WorklogPage />} />
        <Route
          path="/admin/users"
          element={
            <RequireSuperuser>
              <AdminUsersPage />
            </RequireSuperuser>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
