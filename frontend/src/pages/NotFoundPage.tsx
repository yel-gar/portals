import { Button, Result } from "antd";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <Result
      status="404"
      title="404"
      subTitle="Страница не найдена."
      extra={
        <Button type="primary">
          <Link to="/portals">К порталам</Link>
        </Button>
      }
    />
  );
}
