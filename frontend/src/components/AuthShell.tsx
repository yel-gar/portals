import type { ReactNode } from "react";
import { Card, Typography } from "antd";

import { LOGO_ICON } from "../constants";

/** Centered card used by the login and registration pages. */
export function AuthShell({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const LogoIcon = LOGO_ICON;
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="app-logo-icon">
            <LogoIcon />
          </span>
          <span>Лаборатория порталов</span>
        </div>
        <Card title={title} styles={{ body: { paddingTop: 20 } }}>
          {children}
        </Card>
        {footer && (
          <Typography.Paragraph style={{ textAlign: "center", marginTop: 16 }} type="secondary">
            {footer}
          </Typography.Paragraph>
        )}
      </div>
    </div>
  );
}
