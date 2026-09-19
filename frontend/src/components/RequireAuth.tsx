import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Result, Spin } from "antd";

import { useMe } from "../hooks/useAuth";

/** Gate behind a valid session; unauthenticated visitors go to the login page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError } = useMe();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="app-loading">
        <Spin size="large" />
      </div>
    );
  }
  if (isError) {
    return (
      <Result
        status="error"
        title="Не удалось проверить сессию"
        subTitle="Проверьте, что сервер доступен, и попробуйте снова."
      />
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

/** Gate behind the superuser flag; regular operators get a 403 page. */
export function RequireSuperuser({ children }: { children: ReactNode }) {
  const { data: user } = useMe();
  if (user && !user.is_superuser) {
    return (
      <Result status="403" title="403" subTitle="Раздел доступен только суперпользователю." />
    );
  }
  return <>{children}</>;
}
